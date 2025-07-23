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
if (
  !process.env.MP_ACCESS_TOKEN ||
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  throw new Error("❌ Variáveis de ambiente faltando.");
}

// Configura Mercado Pago (nova API)
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const payment = new Payment(client);

// Instância do Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Rota para criar pagamento Pix
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { carrinho, nomeCliente, email, total } = req.body;

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

    const dados = pagamento.point_of_interaction.transaction_data;
    const paymentId = pagamento.id;
    const status = pagamento.status;

    // Salva pedido no Supabase
    const { data: pedido, error } = await supabase
      .from("orders")
      .insert({
        mercadopago_payment_id: paymentId.toString(),
        email,
        valor_total: parseFloat(total),
        status: "pendente",
      })
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

    res.json({
      id: paymentId,
      status,
      qr_code_base64: dados.qr_code_base64,
      qr_code: dados.qr_code,
      ticket_url: dados.ticket_url,
      pedido_id: pedido.id,
    });
  } catch (err) {
    console.error("❌ Erro ao criar pagamento:", err);
    res.status(500).json({ error: "Erro ao criar pagamento." });
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
        .from("orders")
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
