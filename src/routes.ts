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

// Validação dos dados de entrada
const createPaymentSchema = z.object({
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
        
        // Se a tabela não existe, retornar instruções
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
      
      // Detectar problemas de rede
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

  // Rota POST /criar-pagamento - Cria um pagamento Pix
  app.post("/criar-pagamento", async (req, res) => {
    try {
      // Validar dados de entrada
      const validation = createPaymentSchema.safeParse(req.body);
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

      // Debug: mostrar estrutura completa do produto
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
}