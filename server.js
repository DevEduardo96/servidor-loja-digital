require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment } = require("mercadopago");

const app = express();

// CORS liberado para origens seguras
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

// Instância do Mercado Pago SDK v2
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});
const payment = new Payment(client);

// Banco de dados temporário (memória)
const pagamentos = {};

app.get("/", (req, res) => {
  res.send("✅ Backend Mercado Pago rodando!");
});

// 🔧 ROTA PARA CRIAR PAGAMENTO PIX
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { nomeCliente, email, total } = req.body;

    if (!nomeCliente || !email || !total) {
      return res.status(400).json({ error: "Faltando dados obrigatórios" });
    }

    // Converte string "R$ 10,00" em 10.00
    let valorTotal = 0;
    if (typeof total === "string") {
      valorTotal = parseFloat(total.replace("R$", "").replace(/\./g, "").replace(",", "."));
    } else if (typeof total === "number") {
      valorTotal = total;
    }

    if (isNaN(valorTotal) || valorTotal <= 0) {
      return res.status(400).json({ error: "Valor total inválido" });
    }

    console.log("🚀 Criando pagamento PIX para:", nomeCliente, "- Valor:", valorTotal);

    const pagamento = await payment.create({
      body: {
        transaction_amount: valorTotal,
        description: "Compra de produtos digitais",
        payment_method_id: "pix",
        payer: {
          email: "cliente@artfy.com", // 👈🏻 Evita envio automático
          first_name: nomeCliente,
        },
      }
    });

    console.log("✅ Pagamento criado:", pagamento.id);

    const txData = pagamento.point_of_interaction?.transaction_data || {};

    // Armazena informações no "banco" local
    pagamentos[pagamento.id] = {
      status: pagamento.status,
      email, // 👈🏻 Armazena o e-mail real aqui
      nomeCliente,
      criadoEm: Date.now(),
      link: "https://exemplo.com/downloads/arquivo.zip", // 🔁 Substitua pelo real
    };

    const response = {
      id: pagamento.id,
      status: pagamento.status,
      qr_code: txData.qr_code || null,
      qr_code_base64: txData.qr_code_base64 || null,
      ticket_url: txData.ticket_url || null,
    };

    res.json(response);
  } catch (error) {
    console.error("❌ Erro ao criar pagamento Pix:", error);
    res.status(500).json({
      error: "Erro ao criar pagamento Pix",
      detalhes: error.message || error.toString(),
    });
  }
});

// 🔄 VERIFICA STATUS DE UM PAGAMENTO
app.get("/status-pagamento/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pagamento = await payment.get({ id });

    if (pagamentos[id]) {
      pagamentos[id].status = pagamento.status;
    }

    const txData = pagamento.point_of_interaction?.transaction_data || {};

    const response = {
      id: pagamento.id,
      status: pagamento.status,
      qr_code: txData.qr_code || null,
      qr_code_base64: txData.qr_code_base64 || null,
      ticket_url: txData.ticket_url || null,
      link: pagamentos[id]?.link || null,
    };

    res.json(response);
  } catch (error) {
    console.error("❌ Erro ao consultar status:", error.message);
    res.status(500).json({ error: "Erro ao consultar pagamento" });
  }
});

// 🔓 ENTREGA LINK DE DOWNLOAD (com verificação)
app.get("/link-download/:id", (req, res) => {
  const { id } = req.params;
  const registro = pagamentos[id];

  if (!registro) {
    return res.status(404).json({ erro: "Pagamento não encontrado." });
  }

  if (registro.status !== "approved") {
    return res.status(403).json({ erro: "Pagamento ainda não foi aprovado." });
  }

  const expirado = Date.now() - registro.criadoEm > 10 * 60 * 1000; // 10 minutos
  if (expirado) {
    return res.status(410).json({ erro: "Link expirado." });
  }

  return res.json({ link: registro.link });
});

// 🔔 WEBHOOK (opcional, não implementado ainda)
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  console.log("📩 Webhook recebido:", req.body);
  res.status(200).send("OK");
});

// 🔎 Consulta simplificada (backup)
app.get("/pagamento/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pagamento = await payment.get({ id });

    if (pagamentos[id]) {
      pagamentos[id].status = pagamento.status;
    }

    res.json({
      id: pagamento.id,
      status: pagamento.status,
      link: pagamentos[id]?.link || null,
    });
  } catch (error) {
    console.error("❌ Erro ao verificar pagamento:", error.message);
    res.status(500).json({ error: "Erro ao verificar pagamento" });
  }
});

// 🚀 Inicia servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
