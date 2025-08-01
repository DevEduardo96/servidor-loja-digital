import type { Express } from "express";
import { createClient } from "@supabase/supabase-js";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { z } from "zod";

// Tipos para produtos
interface Produto {
  id: string | number;
  name: string;
  description?: string;
  price: number;
  original_price?: number;
  download_url?: string;
  image_url?: string;
  category?: string;
  is_active?: boolean;
  is_featured?: boolean;
  tags?: string[];
}

// Tipos para carrinho
interface ItemCarrinho {
  id: string | number;
  name: string;
  price?: number;
  quantity: number;
}

// Tipos para download
interface DownloadInfo {
  produto_id: string | number;
  produto_nome: string;
  download_url: string;
}

// Função auxiliar para retry com backoff
async function retryWithBackoff<T>(
  fn: () => Promise<T>, 
  maxRetries: number = 3, 
  delay: number = 1000
): Promise<T> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
  throw new Error("Max retries exceeded");
}

// Validação dos dados de entrada para pagamento (estrutura real do frontend)
const createPaymentSchema = z.object({
  carrinho: z.array(z.object({
    id: z.union([z.string(), z.number()]),
    name: z.string(),
    price: z.union([z.number(), z.string()]).optional().transform(val => {
      if (val === undefined) return undefined;
      const num = typeof val === 'string' ? parseFloat(val) : val;
      if (isNaN(num)) throw new Error("Preço inválido");
      return num;
    }),
    quantity: z.number().min(1, "Quantidade deve ser maior que zero")
  })),
  nomeCliente: z.string().min(1, "Nome do cliente é obrigatório"),
  email: z.string().email("Email inválido"),
  total: z.union([z.number(), z.string()]).transform(val => {
    const num = typeof val === 'string' ? parseFloat(val) : val;
    if (isNaN(num) || num <= 0) {
      throw new Error("Total deve ser um número maior que zero");
    }
    return num;
  })
});

// Validação para busca de produto individual
const productSchema = z.object({
  produtoId: z.union([z.string(), z.number()]).transform(val => String(val)),
  email: z.string().email(),
});

// Função para testar conectividade do Supabase
async function testarConexaoSupabase(supabase: any): Promise<boolean> {
  try {
    console.log(`[${new Date().toISOString()}] 🧪 Testando conexão Supabase...`);
    
    // Teste simples de conectividade
    const { data, error } = await supabase
      .from("produtos")
      .select("id")
      .limit(1);
      
    if (error) {
      console.error(`[${new Date().toISOString()}] ❌ Erro no teste de conexão:`, {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code
      });
      return false;
    }
    
    console.log(`[${new Date().toISOString()}] ✅ Conexão Supabase OK`);
    return true;
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Falha crítica na conexão:`, {
      error_type: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

// Função para buscar produtos do carrinho no Supabase
async function buscarProdutosCarrinho(supabase: any, carrinho: ItemCarrinho[]): Promise<Produto[]> {
  try {
    const produtoIds = carrinho.map(item => String(item.id));
    
    console.log(`[${new Date().toISOString()}] 🔍 Buscando produtos IDs:`, produtoIds);
    
    // Testar conexão primeiro
    const conexaoOk = await testarConexaoSupabase(supabase);
    if (!conexaoOk) {
      throw new Error("Falha na conectividade com o banco de dados");
    }
    
    // Buscar produtos com timeout
    const timeoutMs = 10000; // 10 segundos
    const queryPromise = supabase
      .from("produtos")
      .select(`
        id, 
        name, 
        description, 
        price, 
        original_price, 
        download_url, 
        image_url, 
        category,
        is_active
      `)
      .in("id", produtoIds)
      .eq("is_active", true);
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error("Timeout na consulta ao banco")), timeoutMs)
    );
    
    const { data: produtos, error } = await Promise.race([
      queryPromise,
      timeoutPromise
    ]) as any;

    if (error) {
      console.error(`[${new Date().toISOString()}] ❌ Erro Supabase:`, {
        message: error.message,
        details: error.details,
        hint: error.hint,
        code: error.code,
        query_ids: produtoIds
      });
      
      // Tratamento específico de erros do Supabase
      if (error.code === "PGRST116") {
        throw new Error("Tabela 'produtos' não encontrada. Verifique a estrutura do banco.");
      }
      if (error.code === "PGRST301") {
        throw new Error("Erro de autenticação. Verifique as credenciais do Supabase.");
      }
      if (error.message?.includes("JWT")) {
        throw new Error("Token de acesso expirado ou inválido.");
      }
      
      throw new Error(`Erro do banco de dados: ${error.message}`);
    }

    console.log(`[${new Date().toISOString()}] 📦 Produtos encontrados: ${produtos?.length || 0}`);
    
    // Log dos produtos encontrados para debug
    if (produtos && produtos.length > 0) {
      console.log(`[${new Date().toISOString()}] 📋 Produtos retornados:`, 
        produtos.map((p: any) => ({ 
          id: p.id, 
          name: p.name, 
          price: p.price,
          has_download: !!p.download_url,
          is_active: p.is_active
        }))
      );
    }
    
    return produtos || [];
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Erro ao buscar produtos:`, {
      error_type: error instanceof Error ? error.constructor.name : typeof error,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack?.substring(0, 500) : undefined,
      produto_ids: carrinho.map(item => item.id)
    });
    
    // Tratar diferentes tipos de erro
    if (error instanceof Error) {
      if (error.message.includes("fetch failed") || error.message.includes("network")) {
        throw new Error("Problema de conectividade com o banco de dados. Verifique sua conexão de internet.");
      }
      if (error.message.includes("Timeout")) {
        throw new Error("Tempo limite excedido ao consultar o banco. Tente novamente.");
      }
      if (error.message.includes("Invalid API key") || error.message.includes("unauthorized")) {
        throw new Error("Erro de autenticação com o banco de dados. Verifique as configurações.");
      }
      if (error.message.includes("relation") && error.message.includes("does not exist")) {
        throw new Error("Tabela 'produtos' não encontrada no banco de dados.");
      }
    }
    
    throw error;
  }
}

// Função para salvar pedido no banco
async function salvarPedido(supabase: any, dadosPedido: {
  paymentId: string | number;
  email: string;
  nomeCliente: string;
  total: number;
  carrinho: ItemCarrinho[];
  produtos: Produto[];
}) {
  try {
    // 1. Inserir pedido principal
    const { data: pedido, error: pedidoError } = await supabase
      .from("pedidos")
      .insert({
        payment_id: dadosPedido.paymentId,
        email: dadosPedido.email,
        nome_cliente: dadosPedido.nomeCliente,
        valor_total: dadosPedido.total,
        status: 'pending',
        created_at: new Date().toISOString()
      })
      .select()
      .single();

    if (pedidoError) {
      console.error(`[${new Date().toISOString()}] ❌ Erro ao salvar pedido:`, pedidoError);
      return null;
    }

    // 2. Inserir itens do pedido
    const itens = dadosPedido.produtos.map((produto: Produto) => {
      const itemCarrinho = dadosPedido.carrinho.find((c: ItemCarrinho) => String(c.id) === String(produto.id));
      return {
        pedido_id: pedido.id,
        produto_id: produto.id,
        quantidade: itemCarrinho?.quantity || 1,
        preco_unitario: produto.price
      };
    });

    const { error: itensError } = await supabase
      .from("pedido_itens")
      .insert(itens);

    if (itensError) {
      console.error(`[${new Date().toISOString()}] ❌ Erro ao salvar itens:`, itensError);
    }

    return pedido;
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Erro geral ao salvar pedido:`, error);
    return null;
  }
}

export function registerRoutes(app: Express): void {
  // Configuração do Supabase com validação robusta
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  console.log(`[${new Date().toISOString()}] 🔧 Configuração do Supabase:`);
  console.log(`[${new Date().toISOString()}] URL: ${supabaseUrl ? `${supabaseUrl.substring(0, 50)}...` : "❌ Não configurada"}`);
  console.log(`[${new Date().toISOString()}] KEY: ${supabaseKey ? `${supabaseKey.substring(0, 20)}...` : "❌ Não configurada"}`);
  console.log(`[${new Date().toISOString()}] NODE_ENV: ${process.env.NODE_ENV || "development"}`);
  
  // Validações mais rigorosas
  if (!supabaseUrl) {
    console.error(`[${new Date().toISOString()}] ❌ CRÍTICO: SUPABASE_URL não configurada`);
  } else if (!supabaseUrl.startsWith('https://')) {
    console.error(`[${new Date().toISOString()}] ⚠️ AVISO: SUPABASE_URL deve começar com https://`);
  }
  
  if (!supabaseKey) {
    console.error(`[${new Date().toISOString()}] ❌ CRÍTICO: SUPABASE_KEY não configurada`);
  } else if (supabaseKey.length < 50) {
    console.error(`[${new Date().toISOString()}] ⚠️ AVISO: SUPABASE_KEY parece muito curta`);
  }
  
  let supabase = null;
  if (supabaseUrl && supabaseKey) {
    try {
      supabase = createClient(supabaseUrl, supabaseKey, {
        auth: {
          persistSession: false
        },
        db: {
          schema: 'public'
        },
        global: {
          headers: {
            'User-Agent': 'artfy-backend/1.0'
          }
        }
      });
      console.log(`[${new Date().toISOString()}] ✅ Cliente Supabase criado com sucesso`);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Erro ao criar cliente Supabase:`, error);
    }
  }

  // Configuração do Mercado Pago
  const mercadoPagoAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  
  console.log(`[${new Date().toISOString()}] 💳 Mercado Pago: ${mercadoPagoAccessToken ? "✅ Configurado" : "❌ Não configurado"}`);
  
  if (!mercadoPagoAccessToken) {
    console.error(`[${new Date().toISOString()}] ❌ Variável MERCADO_PAGO_ACCESS_TOKEN deve estar configurada`);
  }
  
  const client = mercadoPagoAccessToken ? new MercadoPagoConfig({ 
    accessToken: mercadoPagoAccessToken,
    options: { timeout: 5000 }
  }) : null;
  
  const payment = client ? new Payment(client) : null;

  // Rota GET /produtos - Retorna todos os produtos da tabela produtos
  app.get("/produtos", async (req, res) => {
    try {
      if (!supabase) {
        return res.status(500).json({ 
          error: "Supabase não configurado. Verifique as variáveis de ambiente." 
        });
      }

      console.log(`[${new Date().toISOString()}] 🔍 Buscando produtos...`);
      
      const result = await retryWithBackoff(async () => {
        return await supabase
          .from("produtos")
          .select("id, name, description, price, original_price, image_url, category, download_url, is_active, is_featured, tags")
          .eq("is_active", true) // Só produtos ativos
          .order("created_at", { ascending: false });
      }, 2, 500);

      const { data: produtos, error } = result;

      if (error) {
        console.error(`[${new Date().toISOString()}] ❌ Erro do Supabase:`, error);
        
        if (error.message?.includes("does not exist") || error.message?.includes("não existe")) {
          return res.status(404).json({ 
            error: "Tabela 'produtos' não encontrada",
            instructions: "Verifique se a tabela 'produtos' existe no Supabase",
            details: error.message 
          });
        }
        
        return res.status(500).json({ 
          error: "Erro do banco de dados", 
          details: error.message 
        });
      }

      console.log(`[${new Date().toISOString()}] ✅ Produtos encontrados: ${produtos?.length || 0}`);
      res.json(produtos || []);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Erro inesperado:`, error);
      
      if (error instanceof Error && error.message.includes("fetch failed")) {
        return res.status(503).json({ 
          error: "Problema de conectividade com Supabase",
          suggestion: "Verifique se a URL do Supabase está correta e acessível",
          details: error.message
        });
      }
      
      res.status(500).json({ 
        error: "Erro interno do servidor",
        details: error instanceof Error ? error.message : "Erro desconhecido"
      });
    }
  });

  // ROTA PRINCIPAL: POST /api/payments/criar-pagamento - Para o frontend
  app.post("/api/payments/criar-pagamento", async (req, res) => {
    try {
      console.log(`[${new Date().toISOString()}] 🛒 Dados recebidos:`, JSON.stringify(req.body, null, 2));

      // Validar dados de entrada
      const validation = createPaymentSchema.safeParse(req.body);
      if (!validation.success) {
        console.error(`[${new Date().toISOString()}] ❌ Erro de validação:`, validation.error.errors);
        return res.status(400).json({ 
          error: "Dados inválidos", 
          details: validation.error.errors,
          received_data: req.body
        });
      }

      const { carrinho, nomeCliente, email, total } = validation.data;

      if (!payment || !supabase) {
        return res.status(500).json({ 
          error: "Serviços não configurados. Verifique Mercado Pago e Supabase." 
        });
      }

      // 🔥 BUSCAR PRODUTOS DO SUPABASE INCLUINDO download_url
      console.log(`[${new Date().toISOString()}] 🔍 Buscando produtos no Supabase...`);
      console.log(`[${new Date().toISOString()}] 🔧 Supabase URL: ${supabaseUrl ? `${supabaseUrl.substring(0, 50)}...` : "❌ Não configurada"}`);
      
      let produtos: Produto[];
      try {
        produtos = await buscarProdutosCarrinho(supabase, carrinho);
      } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Falha ao buscar produtos:`, error);
        
        // Retornar erro mais específico baseado no tipo de falha
        if (error instanceof Error) {
          if (error.message.includes("conectividade")) {
            return res.status(503).json({
              error: "Serviço temporariamente indisponível",
              details: "Problema de conectividade com o banco de dados",
              suggestion: "Tente novamente em alguns instantes",
              timestamp: new Date().toISOString()
            });
          }
          
          if (error.message.includes("autenticação")) {
            return res.status(500).json({
              error: "Erro de configuração do servidor",
              details: "Problema de autenticação com o banco de dados",
              suggestion: "Entre em contato com o suporte",
              timestamp: new Date().toISOString()
            });
          }
        }
        
        return res.status(500).json({
          error: "Erro ao acessar produtos",
          details: error instanceof Error ? error.message : "Erro desconhecido",
          suggestion: "Verifique se os produtos existem e tente novamente",
          timestamp: new Date().toISOString()
        });
      }
      
      if (produtos.length === 0) {
        console.log(`[${new Date().toISOString()}] ⚠️ Nenhum produto encontrado para IDs:`, carrinho.map(item => item.id));
        return res.status(404).json({
          error: "Produtos não encontrados no banco de dados",
          carrinho_ids: carrinho.map(item => item.id),
          suggestion: "Verifique se os produtos ainda estão disponíveis",
          timestamp: new Date().toISOString()
        });
      }

      console.log(`[${new Date().toISOString()}] 📦 Produtos encontrados:`, 
        produtos.map((p: Produto) => ({ id: p.id, name: p.name, has_download: !!p.download_url }))
      );

      // Criar descrição baseada no carrinho
      const firstItem = carrinho[0];
      const itemName = firstItem.name;
      const description = carrinho.length === 1 
        ? itemName
        : `Compra de ${carrinho.length} produtos - ${itemName} e outros`;

      const paymentData = {
        transaction_amount: total,
        description: description,
        payment_method_id: "pix",
        payer: {
          email: email,
          first_name: nomeCliente,
        },
        metadata: {
          carrinho: carrinho.map(item => ({
            produto_id: item.id,
            nome: item.name,
            quantidade: item.quantity
          })),
          cliente: nomeCliente,
          total_itens: carrinho.length
        }
      };

      console.log(`[${new Date().toISOString()}] 💳 Criando pagamento PIX:`, {
        amount: total,
        description,
        email,
        cliente: nomeCliente,
        items_count: carrinho.length
      });

      const paymentResponse = await payment.create({ body: paymentData });

      if (!paymentResponse || !paymentResponse.id) {
        return res.status(500).json({ 
          error: "Erro ao criar pagamento no Mercado Pago - ID não retornado" 
        });
      }

      // 🔥 SALVAR PEDIDO NO BANCO
      const pedidoSalvo = await salvarPedido(supabase, {
        paymentId: paymentResponse.id,
        email,
        nomeCliente,
        total,
        carrinho,
        produtos
      });

      // 🔥 MONTAR RESPOSTA COM DOWNLOAD_URLs CORRETOS
      const paymentInfo = {
        id: paymentResponse.id,
        status: paymentResponse.status,
        qr_code: paymentResponse.point_of_interaction?.transaction_data?.qr_code || null,
        qr_code_base64: paymentResponse.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        ticket_url: paymentResponse.point_of_interaction?.transaction_data?.ticket_url || null,
        total: total,
        cliente: nomeCliente,
        produtos: produtos.map((produto: Produto) => {
          const itemCarrinho = carrinho.find((c: ItemCarrinho) => String(c.id) === String(produto.id));
          return {
            id: produto.id,
            nome: produto.name,
            quantidade: itemCarrinho?.quantity || 1,
            preco: produto.price,
            download_url: produto.download_url // 🔥 INCLUINDO O DOWNLOAD_URL CORRETO!
          };
        }),
        // 🔥 URLs DE DOWNLOAD SEPARADOS PARA FÁCIL ACESSO
        download_urls: produtos
          .filter((p: Produto) => p.download_url) // Só produtos com download
          .map((p: Produto) => ({
            produto_id: p.id,
            produto_nome: p.name,
            download_url: p.download_url!
          } as DownloadInfo)),
        pedido_id: pedidoSalvo?.id || null
      };

      console.log(`[${new Date().toISOString()}] ✅ Pagamento criado com download_urls:`, { 
        id: paymentInfo.id, 
        status: paymentInfo.status,
        download_urls_count: paymentInfo.download_urls.length,
        urls: paymentInfo.download_urls.map((u: DownloadInfo) => ({ produto: u.produto_nome, has_url: !!u.download_url }))
      });

      res.json(paymentInfo);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Erro ao criar pagamento:`, error);
      
      // Tratar erros específicos do Mercado Pago
      if (error && typeof error === 'object' && 'message' in error) {
        const mpError = error as any;
        
        if (mpError.message?.includes("without key enabled for QR")) {
          return res.status(400).json({ 
            error: "Token do Mercado Pago não configurado para PIX",
            suggestion: "Verifique se o token tem permissões para gerar QR codes PIX ou use um token de produção",
            details: mpError.message,
            mp_error_code: mpError.cause?.[0]?.code
          });
        }
        
        if (mpError.message?.includes("bad_request")) {
          return res.status(400).json({ 
            error: "Erro na requisição para Mercado Pago",
            details: mpError.message,
            mp_error_code: mpError.cause?.[0]?.code,
            suggestion: "Verifique os dados enviados ou as configurações da conta Mercado Pago"
          });
        }
      }
      
      res.status(500).json({ 
        error: "Erro interno do servidor",
        details: error instanceof Error ? error.message : "Erro desconhecido"
      });
    }
  });

  // 🔥 NOVA ROTA: Verificar status do pagamento e retornar downloads
  app.get("/api/payments/status-pagamento/:paymentId", async (req, res) => {
    const { paymentId } = req.params;

    if (!paymentId) {
      return res.status(400).json({ error: "ID de pagamento ausente." });
    }

    if (!client || !supabase) {
      return res.status(500).json({ error: "Serviços não configurados." });
    }

    try {
      // 1. Consultar status no Mercado Pago
      const paymentStatus = await new Payment(client).get({ id: paymentId });
      
      // 2. Buscar pedido no banco
      const { data: pedido, error: pedidoError } = await supabase
        .from("pedidos")
        .select(`
          id,
          email,
          nome_cliente,
          valor_total,
          status,
          created_at,
          pedido_itens (
            produto_id,
            quantidade,
            preco_unitario,
            produto:produtos (
              id,
              name,
              description,
              price,
              download_url
            )
          )
        `)
        .eq("payment_id", paymentId)
        .single();

      // 3. Atualizar status do pedido se necessário
      if (paymentStatus.status === 'approved' && pedido && pedido.status !== 'approved') {
        await supabase
          .from("pedidos")
          .update({ status: 'approved' })
          .eq("payment_id", paymentId);
      }

      // 4. Montar resposta completa
      const response = {
        payment: {
          id: paymentStatus.id,
          status: paymentStatus.status,
          status_detail: paymentStatus.status_detail,
          transaction_amount: paymentStatus.transaction_amount,
          date_approved: paymentStatus.date_approved,
          date_created: paymentStatus.date_created,
        },
        pedido: pedido ? {
          id: pedido.id,
          email: pedido.email,
          nome_cliente: pedido.nome_cliente,
          valor_total: pedido.valor_total,
          status: pedido.status,
          created_at: pedido.created_at,
          produtos: pedido.pedido_itens?.map((item: any) => ({
            id: item.produto.id,
            nome: item.produto.name,
            quantidade: item.quantidade,
            preco: item.preco_unitario,
            download_url: item.produto.download_url
          })) || []
        } : null,
        // 🔥 DOWNLOADS DISPONÍVEIS (só se pagamento aprovado)
        downloads_disponiveis: paymentStatus.status === 'approved' && pedido ? 
          pedido.pedido_itens
            ?.filter((item: any) => item.produto.download_url)
            .map((item: any) => ({
              produto_id: item.produto.id,
              produto_nome: item.produto.name,
              download_url: item.produto.download_url
            })) || []
          : []
      };

      return res.json(response);
    } catch (error: any) {
      console.error("[Pagamento] Erro ao consultar status:", error.message);
      return res.status(500).json({
        error: "Erro ao consultar status do pagamento",
        details: error.message,
      });
    }
  });

  // 🔥 NOVA ROTA: Buscar downloads direto por paymentId (para clientes)
  app.get("/api/payments/downloads/:paymentId", async (req, res) => {
    const { paymentId } = req.params;

    if (!supabase) {
      return res.status(500).json({ error: "Supabase não configurado." });
    }

    try {
      console.log(`[${new Date().toISOString()}] 🔍 Buscando downloads para payment: ${paymentId}`);

      // Buscar pedido aprovado com produtos
      const { data: pedido, error } = await supabase
        .from("pedidos")
        .select(`
          id,
          email,
          nome_cliente,
          valor_total,
          status,
          created_at,
          pedido_itens (
            quantidade,
            produto:produtos (
              id,
              name,
              description,
              price,
              download_url
            )
          )
        `)
        .eq("payment_id", paymentId)
        .eq("status", "approved")
        .single();

      if (error || !pedido) {
        console.error(`[${new Date().toISOString()}] ❌ Pedido não encontrado ou não aprovado:`, error?.message);
        return res.status(404).json({ 
          error: "Pedido não encontrado ou pagamento ainda não aprovado",
          suggestion: "Verifique se o pagamento foi processado com sucesso"
        });
      }

      // Extrair downloads disponíveis
      const downloads = pedido.pedido_itens
        ?.filter((item: any) => item.produto.download_url)
        .map((item: any) => ({
          produto_id: item.produto.id,
          nome: item.produto.name,
          descricao: item.produto.description,
          quantidade: item.quantidade,
          download_url: item.produto.download_url
        })) || [];

      const response = {
        pedido_id: pedido.id,
        cliente: pedido.nome_cliente,
        email: pedido.email,
        total: pedido.valor_total,
        data_compra: pedido.created_at,
        downloads_disponiveis: downloads,
        total_downloads: downloads.length,
        status: "aprovado"
      };

      console.log(`[${new Date().toISOString()}] ✅ Downloads encontrados: ${downloads.length}`);
      return res.json(response);
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ❌ Erro ao buscar downloads:`, err);
      res.status(500).json({ error: "Erro ao buscar downloads" });
    }
  });

  // ROTA ORIGINAL MANTIDA: POST /criar-pagamento - Para compatibilidade com produto individual
  app.post("/criar-pagamento", async (req, res) => {
    try {
      // Validar dados de entrada
      const validation = productSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ 
          error: "Dados inválidos", 
          details: validation.error.errors 
        });
      }

      const { produtoId, email } = validation.data;

      if (!supabase) {
        return res.status(500).json({ 
          error: "Supabase não configurado. Verifique as variáveis de ambiente." 
        });
      }

      if (!payment) {
        return res.status(500).json({ 
          error: "Mercado Pago não configurado. Verifique a variável MERCADO_PAGO_ACCESS_TOKEN." 
        });
      }

      // Buscar o produto no Supabase INCLUINDO download_url
      console.log(`[${new Date().toISOString()}] 🔍 Buscando produto com ID: ${produtoId}`);
      
      const { data: produto, error: produtoError } = await retryWithBackoff(async () => {
        return await supabase
          .from("produtos")
          .select("id, name, description, price, original_price, download_url, image_url, category") // 🔥 INCLUINDO download_url
          .eq("id", parseInt(produtoId))
          .eq("is_active", true) // Só produtos ativos
          .single();
      }, 2, 500);

      if (produtoError || !produto) {
        console.error(`[${new Date().toISOString()}] ❌ Erro ao buscar produto:`, produtoError);
        return res.status(404).json({ 
          error: "Produto não encontrado",
          details: produtoError?.message 
        });
      }

      console.log(`[${new Date().toISOString()}] 📋 Produto encontrado:`, { 
        id: produto.id, 
        name: produto.name, 
        price: produto.price,
        has_download: !!produto.download_url
      });

      // Criar pagamento Pix no Mercado Pago
      const amount = parseFloat(produto.price || "0");
      const description = produto.name || "Produto";
      
      if (!amount || amount <= 0) {
        return res.status(400).json({ 
          error: "Preço do produto inválido",
          details: `Preço encontrado: ${amount}` 
        });
      }

      const paymentData = {
        transaction_amount: amount,
        description: description,
        payment_method_id: "pix",
        payer: {
          email: email,
        },
      };

      console.log(`[${new Date().toISOString()}] 💳 Criando pagamento:`, {
        amount,
        description,
        email
      });

      const paymentResponse = await payment.create({ body: paymentData });

      if (!paymentResponse || !paymentResponse.id) {
        return res.status(500).json({ 
          error: "Erro ao criar pagamento no Mercado Pago - ID não retornado" 
        });
      }

      // 🔥 SALVAR PEDIDO INDIVIDUAL
      const pedidoSalvo = await salvarPedido(supabase, {
        paymentId: paymentResponse.id,
        email,
        nomeCliente: email.split('@')[0], // Nome baseado no email
        total: amount,
        carrinho: [{ id: produto.id, name: produto.name, quantity: 1 }],
        produtos: [produto]
      });

      // 🔥 INCLUIR download_url NA RESPOSTA
      const paymentInfo = {
        id: paymentResponse.id,
        status: paymentResponse.status,
        qr_code: paymentResponse.point_of_interaction?.transaction_data?.qr_code || null,
        qr_code_base64: paymentResponse.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        ticket_url: paymentResponse.point_of_interaction?.transaction_data?.ticket_url || null,
        produto: {
          id: produto.id,
          nome: produto.name,
          preco: produto.price,
          download_url: produto.download_url // 🔥 DOWNLOAD_URL CORRETO!
        },
        pedido_id: pedidoSalvo?.id || null
      };

      console.log(`[${new Date().toISOString()}] ✅ Pagamento criado:`, { 
        id: paymentInfo.id, 
        status: paymentInfo.status,
        has_download_url: !!produto.download_url
      });

      res.json(paymentInfo);
    } catch (error) {
      console.error(`[${new Date().toISOString()}] ❌ Erro ao criar pagamento:`, error);
      
      // Tratar erros específicos do Mercado Pago
      if (error && typeof error === 'object' && 'message' in error) {
        const mpError = error as any;
        
        if (mpError.message?.includes("without key enabled for QR")) {
          return res.status(400).json({ 
            error: "Token do Mercado Pago não configurado para PIX",
            suggestion: "Verifique se o token tem permissões para gerar QR codes PIX ou use um token de produção",
            details: mpError.message,
            mp_error_code: mpError.cause?.[0]?.code
          });
        }
        
        if (mpError.message?.includes("bad_request")) {
          return res.status(400).json({ 
            error: "Erro na requisição para Mercado Pago",
            details: mpError.message,
            mp_error_code: mpError.cause?.[0]?.code,
            suggestion: "Verifique os dados enviados ou as configurações da conta Mercado Pago"
          });
        }
      }
      
      res.status(500).json({ 
        error: "Erro interno do servidor",
        details: error instanceof Error ? error.message : "Erro desconhecido"
      });
    }
  });

  // Rota de teste para verificar estrutura do carrinho
  app.post("/api/payments/test-carrinho", (req, res) => {
    console.log(`[TEST] Estrutura do carrinho recebida:`, JSON.stringify(req.body, null, 2));
    
    res.json({
      message: "Dados recebidos com sucesso!",
      estrutura_recebida: {
        carrinho: req.body.carrinho?.map((item: any, index: number) => ({
          index,
          tem_product: !!item.product,
          product_id: item.product?.id,
          product_name: item.product?.name,
          product_price: item.product?.price,
          quantity: item.quantity
        })),
        nomeCliente: req.body.nomeCliente,
        email: req.body.email,
        total: req.body.total,
        tipos: {
          carrinho: typeof req.body.carrinho,
          nomeCliente: typeof req.body.nomeCliente,
          email: typeof req.body.email,
          total: typeof req.body.total
        }
      },
      timestamp: new Date().toISOString()
    });
  });

  // 🔧 NOVA ROTA: Diagnóstico completo do sistema
  app.get("/api/diagnostico", async (req, res) => {
    const diagnostico = {
      timestamp: new Date().toISOString(),
      ambiente: process.env.NODE_ENV || "development",
      configuracoes: {
        supabase_url: !!supabaseUrl,
        supabase_key: !!supabaseKey,
        mercado_pago: !!mercadoPagoAccessToken
      },
      testes: {} as any
    };

    // Teste Supabase
    if (supabase) {
      try {
        console.log(`[${new Date().toISOString()}] 🧪 Executando diagnóstico Supabase...`);
        
        const startTime = Date.now();
        const { data, error, count } = await supabase
          .from("produtos")
          .select("id, name, price, is_active", { count: 'exact' })
          .eq("is_active", true)
          .limit(5);
        
        const responseTime = Date.now() - startTime;
        
        if (error) {
          diagnostico.testes.supabase = {
            status: "ERRO",
            erro: error.message,
            codigo: error.code,
            detalhes: error.details,
            tempo_resposta: responseTime
          };
        } else {
          diagnostico.testes.supabase = {
            status: "OK",
            produtos_ativos: count || 0,
            produtos_retornados: data?.length || 0,
            tempo_resposta: responseTime,
            amostra: data?.slice(0, 2).map((p: any) => ({ 
              id: p.id, 
              name: p.name, 
              price: p.price 
            }))
          };
        }
      } catch (error) {
        diagnostico.testes.supabase = {
          status: "FALHA_CRITICA",
          erro: error instanceof Error ? error.message : String(error),
          tipo: error instanceof Error ? error.constructor.name : typeof error
        };
      }
    } else {
      diagnostico.testes.supabase = {
        status: "NAO_CONFIGURADO",
        motivo: "Cliente Supabase não foi criado"
      };
    }

    // Teste Mercado Pago
    if (payment) {
      try {
        // Não vamos fazer uma chamada real, apenas verificar se o cliente foi criado
        diagnostico.testes.mercado_pago = {
          status: "CONFIGURADO",
          cliente_criado: true
        };
      } catch (error) {
        diagnostico.testes.mercado_pago = {
          status: "ERRO_CONFIGURACAO",
          erro: error instanceof Error ? error.message : String(error)
        };
      }
    } else {
      diagnostico.testes.mercado_pago = {
        status: "NAO_CONFIGURADO",
        motivo: "Token não fornecido ou inválido"
      };
    }

    // Status geral
    const supabaseOk = diagnostico.testes.supabase?.status === "OK";
    const mpOk = diagnostico.testes.mercado_pago?.status === "CONFIGURADO";
    
    diagnostico.status_geral = supabaseOk && mpOk ? "OPERACIONAL" : "COM_PROBLEMAS";
    
    const statusCode = supabaseOk ? 200 : 503;
    
    console.log(`[${new Date().toISOString()}] 📊 Diagnóstico concluído:`, {
      supabase: diagnostico.testes.supabase?.status,
      mercado_pago: diagnostico.testes.mercado_pago?.status,
      status_geral: diagnostico.status_geral
    });
    
    res.status(statusCode).json(diagnostico);
  });

  // Rota de teste para verificar se as rotas de pagamento estão funcionando
  app.get("/api/payments/test", (req, res) => {
    res.json({
      message: "API de pagamentos funcionando!",
      routes: [
        "POST /api/payments/criar-pagamento (criar pagamento carrinho)",
        "GET /api/payments/status-pagamento/:paymentId (consultar status)",
        "GET /api/payments/downloads/:paymentId (buscar downloads)",
        "POST /api/payments/test-carrinho (testar estrutura)", 
        "POST /criar-pagamento (produto individual)",
        "GET /api/diagnostico (diagnóstico completo)"
      ],
      timestamp: new Date().toISOString(),
      supabase_status: supabase ? "configurado" : "não configurado",
      mercado_pago_status: payment ? "configurado" : "não configurado"
    });
  });
}