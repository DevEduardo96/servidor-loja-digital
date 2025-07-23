// server.js
import express from "express";
import cors from "cors";
import "dotenv/config";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// Verifica variáveis de ambiente
console.log("🔍 Verificando variáveis de ambiente...");
if (
  !process.env.MP_ACCESS_TOKEN ||
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  console.error("❌ Variáveis de ambiente faltando:");
  console.error("MP_ACCESS_TOKEN:", !!process.env.MP_ACCESS_TOKEN);
  console.error("SUPABASE_URL:", !!process.env.SUPABASE_URL);
  console.error(
    "SUPABASE_SERVICE_ROLE_KEY:",
    !!process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  throw new Error("❌ Variáveis de ambiente faltando.");
}
console.log("✅ Todas as variáveis de ambiente estão configuradas");

// Configura Mercado Pago (nova API)
console.log("🔄 Configurando MercadoPago...");
let payment;
try {
  const client = new MercadoPagoConfig({
    accessToken: process.env.MP_ACCESS_TOKEN,
  });

  payment = new Payment(client);
  console.log("✅ MercadoPago configurado com sucesso");
} catch (error) {
  console.error("❌ Erro ao configurar MercadoPago:", error);
  throw error;
}

// Instância do Supabase
console.log("🔄 Configurando Supabase...");
let supabase;
try {
  supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  console.log("✅ Supabase configurado com sucesso");
} catch (error) {
  console.error("❌ Erro ao configurar Supabase:", error);
  throw error;
}

// Rota para criar pagamento Pix
app.post("/criar-pagamento", async (req, res) => {
  try {
    console.log("🔄 Iniciando criação de pagamento...");
    const { carrinho, nomeCliente, email, total } = req.body;

    console.log("📋 Dados recebidos:", {
      carrinho: carrinho?.length,
      nomeCliente,
      email,
      total,
    });

    // Validação básica
    if (!email || !nomeCliente || !total) {
      console.error("❌ Dados obrigatórios faltando");
      return res.status(400).json({
        error: "Email, nome e total são obrigatórios",
      });
    }

    console.log("🔄 Criando pagamento no MercadoPago...");

    // Cria pagamento Pix com a nova API
    const pagamento = await payment.create({
      body: {
        transaction_amount: parseFloat(total),
        description: "Compra de produtos digitais",
        payment_method_id: "pix",
        payer: {
          email,
          first_name: nomeCliente,
        },
      },
    });

    console.log("✅ Pagamento criado no MercadoPago:", {
      id: pagamento.id,
      status: pagamento.status,
    });

    const dados = pagamento.point_of_interaction?.transaction_data;
    const paymentId = pagamento.id;
    const status = pagamento.status;

    if (!dados) {
      console.error("❌ Dados do QR Code não encontrados na resposta do MP");
      return res.status(500).json({
        error: "Erro ao obter dados do QR Code",
      });
    }

    console.log("🔄 Salvando pedido no Supabase...");

    // Salva pedido no Supabase
    const { data: pedido, error } = await supabase
      .from("pedidos") // ✅ Nome correto da tabela
      .insert([
        {
          payment_id: paymentId,
          email,
          valor_total: total,
          status: "pendente",
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("❌ Erro ao salvar pedido:", error);
      console.error("❌ Detalhes:", JSON.stringify(error, null, 2));
      return res.status(500).json({
        error: "Erro ao salvar pedido.",
        details: error.message,
      });
    }

    console.log("✅ Pedido salvo no Supabase:", pedido.id);

    res.json({
      id: paymentId,
      status,
      qr_code_base64: dados.qr_code_base64,
      qr_code: dados.qr_code,
      ticket_url: dados.ticket_url,
      pedido_id: pedido.id,
    });

    console.log("✅ Resposta enviada com sucesso");
  } catch (err) {
    console.error("❌ Erro geral:", err);
    console.error("❌ Stack trace:", err.stack);
    res.status(500).json({
      error: "Erro ao criar pagamento.",
      message: err.message,
    });
  }
});

// Webhook para receber notificações do Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === "payment") {
      const paymentId = data.id;

      // Busca detalhes do pagamento
      const pagamento = await payment.get({ id: paymentId });

      // Atualiza status no Supabase
      const { error } = await supabase
        .from("pedidos") // ✅ CERTO — sua tabela correta
        .update({ status: pagamento.status })
        .eq("mercadopago_payment_id", paymentId.toString());

      if (error) {
        console.error("❌ Erro ao atualizar pedido:", error);
      } else {
        console.log(
          `✅ Pedido ${paymentId} atualizado para ${pagamento.status}`
        );
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("❌ Erro no webhook:", err);
    res.status(500).send("Erro no webhook");
  }
});

// Rota para verificar status do pagamento
app.get("/pagamento/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pagamento = await payment.get({ id });

    res.json({
      id: pagamento.id,
      status: pagamento.status,
      status_detail: pagamento.status_detail,
    });
  } catch (err) {
    console.error("❌ Erro ao buscar pagamento:", err);
    res.status(500).json({ error: "Erro ao buscar pagamento." });
  }
});

// Inicializa servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
