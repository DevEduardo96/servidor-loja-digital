require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { default: MercadoPago } = require("mercadopago");

const app = express();

const allowedOrigins = [
  "https://artfy.netlify.app",
  "http://localhost:5173",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("CORS origin não permitida: " + origin));
    }
  }
}));

app.use(express.json());

// instancia MercadoPago com token
const mercadopago = new MercadoPago({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// banco temporário
const pagamentos = {};

app.get("/", (req, res) => {
  res.send("✅ Backend Mercado Pago rodando!");
});

app.post("/criar-pagamento", async (req, res) => {
  try {
    const { nomeCliente, email, total } = req.body;

    if (!nomeCliente || !email || !total) {
      return res.status(400).json({ error: "Faltando dados obrigatórios" });
    }

    let valorTotal = 0;
    if (typeof total === "string") {
      valorTotal = parseFloat(total.replace("R$", "").replace(/\./g, "").replace(",", "."));
    } else if (typeof total === "number") {
      valorTotal = total;
    }

    if (isNaN(valorTotal) || valorTotal <= 0) {
      return res.status(400).json({ error: "Valor total inválido" });
    }

    const pagamento = await mercadopago.payment.create({
      transaction_amount: valorTotal,
      description: "Compra de produtos digitais",
      payment_method_id: "pix",
      payer: {
        email,
        first_name: nomeCliente,
      },
    });

    pagamentos[pagamento.id] = {
      status: pagamento.status,
      email,
      nomeCliente,
      criadoEm: Date.now(),
      link: "https://exemplo.com/downloads/arquivo.zip",
    };

    const transactionData = pagamento.point_of_interaction?.transaction_data || {};

    res.json({
      id: pagamento.id,
      status: pagamento.status,
      qr_code: transactionData.qr_code || null,
      qr_code_base64: transactionData.qr_code_base64 || null,
      ticket_url: transactionData.ticket_url || null,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento Pix:", error);
    res.status(500).json({ error: "Erro ao criar pagamento Pix", detalhes: error.toString() });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
