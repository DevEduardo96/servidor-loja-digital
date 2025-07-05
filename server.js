require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment, Preference } = require("mercadopago");

const app = express();
app.use(cors());
app.use(express.json());

// ✅ Inicializa o cliente Mercado Pago
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const paymentClient = new Payment(mpClient);
const preferenceClient = new Preference(mpClient);

// 🔄 Rota para gerar QR Code de pagamento Pix
app.post("/criar-pagamento", async (req, res) => {
  const { carrinho, nomeCliente, total, email } = req.body;

  console.log("📦 Dados recebidos:", { total, nomeCliente, email });

  let valorTotal = 0;
  if (typeof total === "string") {
    valorTotal = parseFloat(
      total.replace("R$", "").replace(/\./g, "").replace(",", ".")
    );
  } else if (typeof total === "number") {
    valorTotal = total;
  } else {
    return res.status(400).json({ error: "Formato de total inválido." });
  }

  if (isNaN(valorTotal) || valorTotal <= 0) {
    return res.status(400).json({ error: "Valor total inválido." });
  }

  try {
    const pagamento = await paymentClient.create({
      body: {
        transaction_amount: valorTotal,
        payment_method_id: "pix",
        description: "Compra de produtos digitais",
        payer: {
          email: email || "comprador@email.com",
          first_name: nomeCliente,
        },
      },
    });

    const dados = pagamento.point_of_interaction.transaction_data;

    res.json({
      id: pagamento.id,
      status: pagamento.status,
      qr_code_base64: dados.qr_code_base64,
      qr_code: dados.qr_code,
      ticket_url: dados.ticket_url,
    });
  } catch (error) {
    console.error("❌ Erro ao gerar pagamento Pix:", error.message);
    res.status(500).json({
      error: "Erro ao gerar pagamento Pix",
      detalhes: error.message,
    });
  }
});

// 🔄 Consulta status do pagamento Pix
app.get("/status-pagamento/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const pagamento = await paymentClient.get({ id });
    res.json({ status: pagamento.status });
  } catch (error) {
    console.error("Erro ao consultar status:", error.message);
    res.status(500).json({ error: "Erro ao consultar pagamento" });
  }
});

// 🔄 Rota para gerar preferência de pagamento (Checkout Pro)
app.post("/criar-preferencia", async (req, res) => {
  try {
    const { itens } = req.body; // Array de { title, quantity, unit_price }

    const resposta = await preferenceClient.create({
      body: {
        items: itens,
        back_urls: {
          success: "https://sualoja.com/sucesso",
          failure: "https://sualoja.com/erro",
          pending: "https://sualoja.com/pendente",
        },
        auto_return: "approved",
      },
    });

    res.json({ init_point: resposta.init_point });
  } catch (error) {
    console.error("Erro ao criar preferência:", error.message);
    res.status(500).json({ error: "Erro ao criar preferência" });
  }
});

// 🚀 Inicializa servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
