// server.js
import express from "express";
import cors from "cors";
import "dotenv/config";
import mercadopago from "mercadopago";
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
  throw new Error(
    "❌ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou MP_ACCESS_TOKEN ausentes."
  );
}

// Configura o Mercado Pago (SDK v2)
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// Instância do Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Rota para criar pagamento Pix
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { carrinho, nomeCliente, email, total } = req.body;

    const pagamento = await mercadopago.payment.create({
      body: {
        transaction_amount: total,
        payment_method_id: "pix",
        description: "Compra de produtos digitais",
        payer: {
          email,
          first_name: nomeCliente,
        },
      },
    });

    const dados = pagamento.body;

    // Salva pedido no Supabase
    const { data: pedido, error } = await supabase
      .from("pedidos")
      .insert([
        {
          payment_id: dados.id.toString(),
          email,
          valor_total: total,
          status: "pendente",
        },
      ])
      .select()
      .single();

    if (error) {
      console.error("Erro ao salvar pedido:", error);
      return res.status(500).json({ error: "Erro ao salvar pedido." });
    }

    res.json({
      id: dados.id,
      qr_code_base64:
        dados.point_of_interaction.transaction_data.qr_code_base64,
      qr_code: dados.point_of_interaction.transaction_data.qr_code,
      pedido_id: pedido.id,
    });
  } catch (err) {
    console.error("Erro ao criar pagamento:", err);
    res.status(500).json({ error: "Erro ao criar pagamento." });
  }
});

// Inicializa servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
