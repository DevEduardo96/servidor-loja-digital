import type { Express } from "express";
import { createClient } from "@supabase/supabase-js";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { z } from "zod";

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

export function registerRoutes(app: Express): void {
  // Configuração do Supabase
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  
  console.log(`[${new Date().toISOString()}] 🔧 Configuração do Supabase:`);
  console.log(`[${new Date().toISOString()}] URL: ${supabaseUrl ? `${supabaseUrl.substring(0, 30)}...` : "❌ Não configurada"}`);
  console.log(`[${new Date().toISOString()}] KEY: ${supabaseKey ? "✅ Configurada" : "❌ Não configurada"}`);
  
  if (!supabaseUrl || !supabaseKey) {
    console.error(`[${new Date().toISOString()}] ❌ Variáveis SUPABASE_URL e SUPABASE_KEY devem estar configuradas`);
  }
  
  const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

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
        return await supabase.from("produtos").select("*");
      }, 2, 500);

      const { data: produtos, error } = result;

      if (error) {
        console.error(`[${new Date().toISOString()}] ❌ Erro do Supabase:`, error);
        
        if (error.message?.includes("does not exist") || error.message?.includes("não existe")) {
          return res.status(404).json({ 
            error: "Tabela 'produtos' não encontrada",
            instructions: "Crie a tabela 'produtos' no Supabase com os campos: id, name, description, price, image_url",
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

  // NOVA ROTA: POST /api/payments/criar-pagamento - Para o frontend
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

      if (!payment) {
        return res.status(500).json({ 
          error: "Mercado Pago não configurado. Verifique a variável MERCADO_PAGO_ACCESS_TOKEN." 
        });
      }

      // Criar descrição baseada no carrinho
      const firstItem = carrinho[0];
      const itemName = firstItem.name;
      const description = carrinho.length === 1 
        ? itemName
        : `Compra de ${carrinho.length} produtos - ${itemName} e outros`;

      // O preço não vem no item, então usamos o total dividido pela quantidade total
      const totalQuantity = carrinho.reduce((sum, item) => sum + item.quantity, 0);
      console.log(`[${new Date().toISOString()}] 📊 Informações do carrinho:`, {
        total_recebido: total,
        total_itens: carrinho.length,
        quantidade_total: totalQuantity,
        primeiro_item: itemName
      });

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

      if (!paymentResponse) {
        return res.status(500).json({ 
          error: "Erro ao criar pagamento no Mercado Pago" 
        });
      }

      // Extrair informações do pagamento
      const paymentInfo = {
        id: paymentResponse.id,
        status: paymentResponse.status,
        qr_code: paymentResponse.point_of_interaction?.transaction_data?.qr_code || null,
        qr_code_base64: paymentResponse.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        ticket_url: paymentResponse.point_of_interaction?.transaction_data?.ticket_url || null,
        total: total,
        cliente: nomeCliente,
        produtos: carrinho.map(item => ({
          id: item.id,
          nome: item.name,
          quantidade: item.quantity
        }))
      };

      console.log(`[${new Date().toISOString()}] ✅ Pagamento criado com sucesso:`, { 
        id: paymentInfo.id, 
        status: paymentInfo.status,
        qr_code_exists: !!paymentInfo.qr_code,
        qr_code_base64_exists: !!paymentInfo.qr_code_base64
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

  // ROTA ORIGINAL MANTIDA: POST /criar-pagamento - Para compatibilidade
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

      // Buscar o produto no Supabase
      console.log(`[${new Date().toISOString()}] 🔍 Buscando produto com ID: ${produtoId}`);
      
      const { data: produto, error: produtoError } = await retryWithBackoff(async () => {
        return await supabase
          .from("produtos")
          .select("*")
          .eq("id", parseInt(produtoId))
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
        price: produto.price 
      });

      // Criar pagamento Pix no Mercado Pago
      const amount = parseFloat(produto.price || produto.preco || "0");
      const description = produto.name || produto.nome || "Produto";
      
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

      if (!paymentResponse) {
        return res.status(500).json({ 
          error: "Erro ao criar pagamento no Mercado Pago" 
        });
      }

      

      // Extrair informações do pagamento
      const paymentInfo = {
        id: paymentResponse.id,
        status: paymentResponse.status,
        qr_code: paymentResponse.point_of_interaction?.transaction_data?.qr_code || null,
        qr_code_base64: paymentResponse.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        ticket_url: paymentResponse.point_of_interaction?.transaction_data?.ticket_url || null,
      };

      console.log(`[${new Date().toISOString()}] ✅ Pagamento criado:`, { 
        id: paymentInfo.id, 
        status: paymentInfo.status 
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
  app.get("/api/payments/status-pagamento/:paymentId", async (req, res) => {
  const { paymentId } = req.params;

  if (!paymentId) {
    return res.status(400).json({ error: "ID de pagamento ausente." });
  }

  if (!client) {
    return res.status(500).json({ error: "Cliente Mercado Pago não configurado." });
  }

  try {
    const paymentStatus = await new Payment(client).get({ id: paymentId });

    return res.json({
      id: paymentStatus.id,
      status: paymentStatus.status,
      status_detail: paymentStatus.status_detail,
      payer_email: paymentStatus.payer?.email,
      transaction_amount: paymentStatus.transaction_amount,
      date_approved: paymentStatus.date_approved,
      date_created: paymentStatus.date_created,
    });
  } catch (error: any) {
    console.error("[Pagamento] Erro ao consultar status:", error.message);
    return res.status(500).json({
      error: "Erro ao consultar status do pagamento",
      details: error.message,
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

  // Rota de teste para verificar se as rotas de pagamento estão funcionando
  app.get("/api/payments/test", (req, res) => {
    res.json({
      message: "API de pagamentos funcionando!",
      routes: [
        "POST /api/payments/criar-pagamento (para carrinho)",
        "POST /api/payments/test-carrinho (para testar estrutura)", 
        "POST /criar-pagamento (para produto individual)"
      ],
      timestamp: new Date().toISOString()
    });
  });

    // NOVA ROTA: Buscar links de download do pedido
  app.get("/api/payments/link-download/:paymentId", async (req, res) => {
    const { paymentId } = req.params;

    if (!supabase) {
      return res.status(500).json({ error: "Supabase não configurado." });
    }

    try {
      console.log(`[${new Date().toISOString()}] 🔍 Buscando links de download para paymentId: ${paymentId}`);

      // Busca pedido + downloads + produtos
      const { data: pedido, error } = await supabase
        .from("pedidos")
        .select(`
          id,
          email,
          valor_total,
          created_at,
          downloads (
            link_temporario,
            expires_at
          ),
          pedido_itens (
            produto:produtos (
              id,
              name,
              description,
              price,
              image_url,
              category
            )
          )
        `)
        .eq("payment_id", paymentId)
        .single();

      if (error || !pedido) {
        console.error(`[${new Date().toISOString()}] ❌ Pedido não encontrado:`, error?.message);
        return res.status(404).json({ error: "Pedido não encontrado" });
      }

      // Extrair links e produtos
      const links = pedido.downloads?.map((d: any) => d.link_temporario) || [];
      const produtos = pedido.pedido_itens?.map((p: any) => p.produto) || [];

      return res.json({
        links,
        products: produtos,
        customerName: pedido.email,
        total: pedido.valor_total,
        downloadedAt: new Date().toISOString(),
        expiresIn: "7 dias"
      });
    } catch (err) {
      console.error(`[${new Date().toISOString()}] ❌ Erro ao buscar links:`, err);
      res.status(500).json({ error: "Erro ao buscar links de download" });
    }
  });

}