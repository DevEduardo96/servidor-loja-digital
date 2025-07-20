require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPago } = require("@mercadopago/sdk-node");

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

// Configura o MercadoPago com seu token de acesso
const mp = new MercadoPago({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// Pagamentos temporários em memória
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

    const pagamento = await mp.payment.create({
      transaction_amount: valorTotal,
      description: "Compra de produtos digitais",
      payment_method_id: "pix",
      payer: {
        email,
        first_name: nomeCliente,
      },
    });

    pagamentos[pagamento.body.id] = {
      status: pagamento.body.status,
      email,
      nomeCliente,
      criadoEm: Date.now(),
      link: "https://exemplo.com/downloads/arquivo.zip",
    };

    const transactionData = pagamento.body.point_of_interaction?.transaction_data || {};

    res.json({
      id: pagamento.body.id,
      status: pagamento.body.status,
      qr_code: transactionData.qr_code || null,
      qr_code_base64: transactionData.qr_code_base64 || null,
      ticket_url: transactionData.ticket_url || null,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento Pix:", error);
    res.status(500).json({ error: "Erro ao criar pagamento Pix", detalhes: error.message });
  }
});

app.get("/status-pagamento/:id", async (req, res) => {
  const { id } = req.params;

  if (!id) return res.status(400).json({ error: "ID do pagamento obrigatório" });

  try {
    const pagamento = await mp.payment.get(id);

    if (!pagamento || !pagamento.body) {
      return res.status(404).json({ error: "Pagamento não encontrado" });
    }

    if (!pagamentos[id]) {
      return res.status(404).json({ error: "Pagamento não registrado no sistema" });
    }

    pagamentos[id].status = pagamento.body.status;

    const transactionData = pagamento.body.point_of_interaction?.transaction_data || {};

    return res.json({
      status: pagamento.body.status,
      qr_code_base64: transactionData.qr_code_base64 || null,
      link: pagamento.body.status === "approved" ? pagamentos[id].link : null,
    });
  } catch (error) {
    console.error("Erro ao consultar pagamento:", error);
    res.status(500).json({ error: "Erro ao consultar pagamento", detalhes: error.message });
  }
});

app.get("/link-download/:id", (req, res) => {
  const { id } = req.params;
  const registro = pagamentos[id];

  if (!registro) return res.status(404).json({ error: "Pagamento não encontrado." });

  if (registro.status !== "approved") return res.status(403).json({ error: "Pagamento não aprovado." });

  const expiracao = 10 * 60 * 1000;
  if (Date.now() - registro.criadoEm > expiracao) return res.status(410).json({ error: "Link expirado." });

  return res.json({ link: registro.link });
});

app.use((err, req, res, next) => {
  if (err.message.startsWith("CORS origin não permitida")) {
    return res.status(403).json({ error: err.message });
  }
  next(err);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
