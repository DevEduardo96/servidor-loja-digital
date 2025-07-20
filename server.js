// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mercadopago = require("mercadopago");

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

// Configura Mercado Pago (SDK antiga)
mercadopago.configure({
  access_token: process.env.MP_ACCESS_TOKEN,
});

// Banco temporário (em memória)
const pagamentos = {};

app.get("/", (req, res) => {
  res.send("✅ Backend Mercado Pago rodando!");
});

// Criar pagamento Pix
app.post("/criar-pagamento", async (req, res) => {
  const { nomeCliente, email, total } = req.body;

  if (!nomeCliente || !email || !total) {
    return res.status(400).json({ error: "Faltando dados obrigatórios" });
  }

  // Converter total para número (ex: "R$ 10,00" para 10.00)
  let valorTotal = 0;
  if (typeof total === "string") {
    valorTotal = parseFloat(
      total.replace("R$", "").replace(/\./g, "").replace(",", ".")
    );
  } else if (typeof total === "number") {
    valorTotal = total;
  }

  if (isNaN(valorTotal) || valorTotal <= 0) {
    return res.status(400).json({ error: "Valor total inválido" });
  }

  try {
    const pagamento = await mercadopago.payment.create({
      transaction_amount: valorTotal,
      description: "Compra de produtos digitais",
      payment_method_id: "pix",
      payer: {
        email: email,
        first_name: nomeCliente,
      },
    });

    // Armazena para status / link
    pagamentos[pagamento.body.id] = {
      status: pagamento.body.status,
      email,
      nomeCliente,
      criadoEm: Date.now(),
      link: "https://exemplo.com/downloads/arquivo.zip", // ajuste seu link aqui
    };

    // Dados do QR Code Pix
    const transactionData = pagamento.body.point_of_interaction.transaction_data;

    res.json({
      id: pagamento.body.id,
      status: pagamento.body.status,
      qr_code: transactionData.qr_code,
      qr_code_base64: transactionData.qr_code_base64,
      ticket_url: transactionData.ticket_url,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento Pix:", error);
    res.status(500).json({ error: "Erro ao criar pagamento Pix" });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
