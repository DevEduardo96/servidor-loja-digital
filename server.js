import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import mercadopago from "mercadopago";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, MP_ACCESS_TOKEN } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !MP_ACCESS_TOKEN) {
  throw new Error("❌ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou MP_ACCESS_TOKEN ausentes.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const mpClient = new mercadopago.MercadoPago(MP_ACCESS_TOKEN, {
  timeout: 5000,
});

app.post("/criar-pagamento", async (req, res) => {
  try {
    const { carrinho, nomeCliente, email, total } = req.body;

    if (!email || !carrinho || carrinho.length === 0 || !total) {
      return res.status(400).json({ error: "Dados incompletos no corpo da requisição." });
    }

    const preference = {
      items: carrinho.map((item) => ({
        title: item.product.name,
        quantity: item.quantity,
        unit_price: item.product.price,
        currency_id: "BRL",
      })),
      payer: {
        name: nomeCliente,
        email,
      },
      payment_methods: {
        excluded_payment_types: [{ id: "credit_card" }, { id: "ticket" }],
        default_payment_method_id: "pix",
      },
      binary_mode: true,
    };

    const response = await mpClient.preferences.create(preference);
    const paymentId = response.id;
    const qr_code_base64 = response.point_of_interaction?.transaction_data?.qr_code_base64;

    const { data: pedido, error: pedidoErro } = await supabase
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

    if (pedidoErro) {
      console.error("Erro ao salvar pedido:", pedidoErro);
      return res.status(500).json({ error: "Erro ao salvar pedido." });
    }

    const itensPedido = carrinho.map((item) => ({
      pedido_id: pedido.id,
      produto_id: item.product.id,
      quantidade: item.quantity,
      preco_unitario: item.product.price,
    }));

    const { error: itensErro } = await supabase.from("pedido_itens").insert(itensPedido);

    if (itensErro) {
      console.error("Erro ao salvar itens:", itensErro);
      return res.status(500).json({ error: "Erro ao salvar itens do pedido." });
    }

    return res.status(200).json({
      id: paymentId,
      qr_code_base64,
    });
  } catch (err) {
    console.error("Erro ao criar pagamento:", err);
    return res.status(500).json({ error: "Erro interno no servidor." });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
