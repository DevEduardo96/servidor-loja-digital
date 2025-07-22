import express from "express";
import cors from "cors";
import { MercadoPagoConfig } from "mercadopago";
import "dotenv/config";

const app = express();
app.use(cors());
app.use(express.json());

const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN!,
  options: { timeout: 5000 },
});

app.post("/criar-pagamento", async (req, res) => {
  try {
    const { carrinho, nomeCliente, email, total } = req.body;

    const items = carrinho.map((item) => ({
      title: item.product.name,
      quantity: item.quantity,
      unit_price: item.product.price,
      currency_id: "BRL",
    }));

    const response = await mercadopago.preferences.create({
      payer: { email },
      items,
      metadata: { email },
      notification_url: "https://servidor-loja-digital.onrender.com/notificacao",
      payment_methods: {
        excluded_payment_types: [{ id: "credit_card" }],
      },
    });

    res.json({
      id: response.id,
      qr_code_base64: response.point_of_interaction?.transaction_data?.qr_code_base64,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento:", error);
    res.status(500).json({ error: "Erro ao criar pagamento" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
