require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Preference } = require("mercadopago");

const app = express();
const PORT = process.env.PORT || 3000;

// CORS seguro
const allowedOrigins = [
  "https://artfy.netlify.app",
  "http://localhost:5173", // dev local
];
app.use(cors({
  origin: allowedOrigins,
  methods: "GET,POST",
  credentials: true,
}));

app.use(express.json());

// Instância do Mercado Pago
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });

// Mapa para armazenar links por preference_id
const downloadsPorPreferencia = new Map();

// Criar preferência de pagamento
app.post("/criar-preferencia", async (req, res) => {
  try {
    const { nome, preco, email, linksDownload } = req.body;

    const preference = await new Preference(client).create({
      body: {
        items: [
          {
            title: nome,
            quantity: 1,
            unit_price: Number(preco),
          },
        ],
        payer: {
          email: email,
        },
        back_urls: {
          success: "https://artfy.netlify.app/sucesso",
          failure: "https://artfy.netlify.app/erro",
        },
        auto_return: "approved",
        metadata: {
          emailUsuario: email,
        },
        notification_url: `${process.env.URL_SERVER}/webhook`,
      },
    });

    // Armazena os links com o preference_id
    downloadsPorPreferencia.set(preference.id, linksDownload);

    res.json({ id: preference.id });
  } catch (error) {
    console.error("Erro ao criar preferência:", error);
    res.status(500).json({ error: "Erro ao criar preferência" });
  }
});

// ✅ Nova rota para consultar status do pagamento
app.get("/status-pagamento/:preference_id", (req, res) => {
  const preferenceId = req.params.preference_id;

  if (downloadsPorPreferencia.has(preferenceId)) {
    return res.json({ status: "approved" });
  }

  return res.json({ status: "pending" });
});

// Retorna links de download
app.get("/links-download/:preference_id", (req, res) => {
  const preferenceId = req.params.preference_id;

  if (downloadsPorPreferencia.has(preferenceId)) {
    return res.json({ links: downloadsPorPreferencia.get(preferenceId) });
  }

  res.status(404).json({ error: "Links não encontrados" });
});

// Webhook do Mercado Pago
app.post("/webhook", (req, res) => {
  console.log("Webhook recebido:", req.body);
  res.sendStatus(200);
});

// Inicializa o servidor
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
