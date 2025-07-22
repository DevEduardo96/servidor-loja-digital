import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";
import mercadopago from "mercadopago";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Verifica se variáveis de ambiente estão presentes
if (
  !process.env.SUPABASE_URL ||
  !process.env.SUPABASE_SERVICE_ROLE_KEY ||
  !process.env.MP_ACCESS_TOKEN
) {
  throw new Error(
    "❌ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ou MP_ACCESS_TOKEN ausentes."
  );
}

// ✅ Inicializa Supabase com service_role_key
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ✅ Configura Mercado Pago
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// 📌 Rota para gerar pagamento PIX
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { carrinho, nomeCliente, email, total } = req.body;

    // 1. Cria preferência no Mercado Pago
    const preference = {
      transaction_amount: total,
      description: "Compra na loja digital",
      payment_method_id: "pix",
      payer: { email, first_name: nomeCliente },
    };

    const { response } = await mercadopago.payment.create(preference);
    const pagamento = response;

    // 2. Salva pedido no Supabase
    const { data: pedido, error: erroPedido } = await supabase
      .from("pedidos")
      .insert([
        {
          payment_id: pagamento.id.toString(),
          email,
          valor_total: total,
          status: pagamento.status,
        },
      ])
      .select()
      .single();

    if (erroPedido) {
      console.error("Erro ao salvar pedido:", erroPedido.message);
      return res.status(500).json({ error: "Erro ao salvar pedido." });
    }

    // 3. Salva os itens do pedido
    const itens = carrinho.map((item) => ({
      pedido_id: pedido.id,
      produto_id: item.product.id,
      quantidade: item.quantity,
      preco_unitario: item.product.price,
    }));

    const { error: erroItens } = await supabase
      .from("pedido_itens")
      .insert(itens);

    if (erroItens) {
      console.error("Erro ao salvar itens:", erroItens.message);
      return res.status(500).json({ error: "Erro ao salvar itens." });
    }

    // 4. Retorna QR Code e ID
    res.json({
      id: pagamento.id,
      qr_code_base64: pagamento.point_of_interaction.transaction_data.qr_code_base64,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento:", error);
    res.status(500).json({ error: "Erro interno no servidor." });
  }
});

// ✅ Inicia o servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
