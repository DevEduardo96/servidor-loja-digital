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
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_KEY;
  const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

  const mercadoPagoAccessToken = process.env.MERCADO_PAGO_ACCESS_TOKEN;
  const client = mercadoPagoAccessToken ? new MercadoPagoConfig({ 
    accessToken: mercadoPagoAccessToken,
    options: { timeout: 5000 }
  }) : null;

  const payment = client ? new Payment(client) : null;

  app.get("/produtos", async (req, res) => {
    try {
      if (!supabase) {
        return res.status(500).json({ error: "Supabase não configurado." });
      }

      const result = await retryWithBackoff(async () => {
        return await supabase.from("produtos").select("*");
      }, 2, 500);

      const { data: produtos, error } = result;

      if (error) {
        return res.status(500).json({ error: error.message });
      }

      res.json(produtos || []);
    } catch (error) {
      res.status(500).json({ error: "Erro interno", details: error instanceof Error ? error.message : error });
    }
  });

  app.post("/api/payments/criar-pagamento", async (req, res) => {
    try {
      const validation = createPaymentSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Dados inválidos", details: validation.error.errors });
      }

      const { carrinho, nomeCliente, email, total } = validation.data;

      if (!payment) {
        return res.status(500).json({ error: "Mercado Pago não configurado." });
      }

      const firstItem = carrinho[0];
      const description = carrinho.length === 1 
        ? firstItem.name
        : `Compra de ${carrinho.length} produtos - ${firstItem.name} e outros`;

      const totalQuantity = carrinho.reduce((sum, item) => sum + item.quantity, 0);

      const paymentData = {
        transaction_amount: total,
        description,
        payment_method_id: "pix",
        payer: { email, first_name: nomeCliente },
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

      const paymentResponse = await payment.create({ body: paymentData });

      const paymentInfo = {
        id: paymentResponse.id,
        status: paymentResponse.status,
        qr_code: paymentResponse.point_of_interaction?.transaction_data?.qr_code || null,
        qr_code_base64: paymentResponse.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        ticket_url: paymentResponse.point_of_interaction?.transaction_data?.ticket_url || null,
        total,
        cliente: nomeCliente,
        produtos: carrinho.map(item => ({
          id: item.id,
          nome: item.name,
          quantidade: item.quantity
        }))
      };

      res.json(paymentInfo);
    } catch (error) {
      res.status(500).json({ error: "Erro ao criar pagamento", details: error instanceof Error ? error.message : error });
    }
  });

  app.post("/criar-pagamento", async (req, res) => {
    try {
      const validation = productSchema.safeParse(req.body);
      if (!validation.success) {
        return res.status(400).json({ error: "Dados inválidos", details: validation.error.errors });
      }

      const { produtoId, email } = validation.data;

      if (!supabase) return res.status(500).json({ error: "Supabase não configurado" });
      if (!payment) return res.status(500).json({ error: "Mercado Pago não configurado" });

      const { data: produto, error: produtoError } = await retryWithBackoff(async () => {
        return await supabase
          .from("produtos")
          .select("*")
          .eq("id", parseInt(produtoId))
          .single();
      }, 2, 500);

      if (produtoError || !produto) {
        return res.status(404).json({ error: "Produto não encontrado", details: produtoError?.message });
      }

      const amount = parseFloat(produto.price || produto.preco || "0");
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: "Preço do produto inválido" });
      }

      const description = produto.name || "Produto";
      const paymentData = {
        transaction_amount: amount,
        description,
        payment_method_id: "pix",
        payer: { email }
      };

      const paymentResponse = await payment.create({ body: paymentData });

      const paymentInfo = {
        id: paymentResponse.id,
        status: paymentResponse.status,
        qr_code: paymentResponse.point_of_interaction?.transaction_data?.qr_code || null,
        qr_code_base64: paymentResponse.point_of_interaction?.transaction_data?.qr_code_base64 || null,
        ticket_url: paymentResponse.point_of_interaction?.transaction_data?.ticket_url || null,
      };

      res.json(paymentInfo);
    } catch (error) {
      res.status(500).json({ error: "Erro interno", details: error instanceof Error ? error.message : error });
    }
  });

  app.post("/api/payments/test-carrinho", (req, res) => {
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
        total: req.body.total
      },
      timestamp: new Date().toISOString()
    });
  });

  app.get("/api/payments/test", (req, res) => {
    res.json({
      message: "API de pagamentos funcionando!",
      routes: [
        "POST /api/payments/criar-pagamento",
        "POST /criar-pagamento",
        "GET /api/payments/status-pagamento/:paymentId"
      ]
    });
  });

  // ✅ NOVA ROTA ADICIONADA AQUI
  app.get("/api/payments/status-pagamento/:paymentId", async (req, res) => {
    const { paymentId } = req.params;

    if (!payment) {
      return res.status(500).json({
        error: "Mercado Pago não configurado. Verifique a variável MERCADO_PAGO_ACCESS_TOKEN."
      });
    }

    try {
      const result = await payment.get(paymentId);

      return res.json({
        id: result.id,
        status: result.status,
        status_detail: result.status_detail,
        payer_email: result.payer?.email,
        transaction_amount: result.transaction_amount,
        date_approved: result.date_approved,
        date_created: result.date_created
      });
    } catch (error) {
      return res.status(404).json({
        error: "Pagamento não encontrado ou erro ao consultar",
        details: error instanceof Error ? error.message : "Erro desconhecido"
      });
    }
  });
}
