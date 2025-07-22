// server.js
import express from 'express';
import cors from 'cors';
import 'dotenv/config';
import { MercadoPagoConfig, Preference } from 'mercadopago';
import { createClient } from '@supabase/supabase-js';

const app = express();
app.use(cors());
app.use(express.json());

// Verifica variáveis de ambiente
if (!process.env.MP_ACCESS_TOKEN || !process.env.SUPABASE_URL || !process.env.SUPABASE_KEY) {
  throw new Error("Variáveis de ambiente faltando.");
}

// Instância do Mercado Pago
const mercadopago = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// Instância do Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// Rota para criar pagamento Pix
app.post('/criar-pagamento', async (req, res) => {
  try {
    const { carrinho, nomeCliente, email, total } = req.body;

    // Cria preferência
    const preference = await mercadopago.preferences.create({
      body: {
        items: carrinho.map((item) => ({
          title: item.product.name,
          quantity: item.quantity,
          unit_price: item.product.price,
          currency_id: "BRL",
        })),
        payer: {
          email,
          name: nomeCliente,
        },
        payment_methods: {
          excluded_payment_types: [{ id: "credit_card" }, { id: "ticket" }],
          default_payment_method_id: "pix",
        },
        statement_descriptor: "Loja Artfix",
        notification_url: "https://webhook.site/teste",
      },
    });

    const paymentId = preference.id;
    const initPoint = preference.init_point;
    const qrCodeBase64 = preference.point_of_interaction?.transaction_data?.qr_code_base64 || null;

    // Salva pedido no Supabase
    const { data: pedido, error } = await supabase
      .from("pedidos")
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
      console.error("Erro ao salvar pedido:", error);
      return res.status(500).json({ error: "Erro ao salvar pedido." });
    }

    res.json({
      id: paymentId,
      init_point: initPoint,
      qr_code_base64: qrCodeBase64,
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
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
