require("dotenv").config();
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { MercadoPagoConfig, Payment, Preference } = require("mercadopago");

const app = express();

// ✅ CORS
const allowedOrigins = [
  "https://artfy.netlify.app",
  "http://localhost:5173",
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      return callback(null, true);
    } else {
      return callback(new Error("CORS origin não permitida: " + origin));
    }
  }
}));

app.use(express.json());

// 🔒 Configura Mercado Pago
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});
const paymentClient = new Payment(mpClient);
const preferenceClient = new Preference(mpClient);

// 🧠 Banco temporário
const pagamentos = {};

// 🔍 Teste
app.get("/", (req, res) => {
  res.send("✅ Backend rodando!");
});

// 📤 Criar pagamento Pix
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
          first_name: nomeCliente || "Cliente",
        },
      },
    });

    const dados = pagamento.point_of_interaction.transaction_data;

    pagamentos[pagamento.id] = {
      status: pagamento.status,
      link: "https://exemplo.com/downloads/arquivo.zip", // Substitua
      criadoEm: Date.now(),
      email,
      nomeCliente,
    };

    console.log("✅ Pagamento criado:", pagamento.id);

    res.json({
      id: pagamento.id,
      status: pagamento.status,
      qr_code_base64: dados.qr_code_base64,
      qr_code: dados.qr_code,
      ticket_url: dados.ticket_url,
    });
  } catch (error) {
    console.error("❌ Erro ao gerar pagamento Pix:", error?.message || error);
    res.status(500).json({
      error: "Erro ao gerar pagamento Pix",
      detalhes: error?.message || "Erro desconhecido",
    });
  }
});

// 🔎 Verificar status e salvar no Supabase
app.get("/status-pagamento/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const pagamento = await paymentClient.get({ id });
    const status = pagamento.status;

    if (pagamentos[id]) {
      pagamentos[id].status = status;
    }

    // Envia pro Supabase se aprovado
    if (status === "approved" && pagamentos[id]?.email) {
      const { email, nomeCliente, link } = pagamentos[id];

      try {
        await axios.post(`${process.env.SUPABASE_URL}/rest/v1/download`, {
          email,
          nome_cliente: nomeCliente,
          link,
        }, {
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          },
        });

        console.log("📨 Registro salvo no Supabase.");
      } catch (e) {
        console.error("❌ Falha ao salvar no Supabase:", e.response?.data || e.message);
      }
    }

    res.json({ status });
  } catch (error) {
    console.error("❌ Erro ao consultar pagamento:", error?.message || error);
    res.status(500).json({ error: "Erro ao consultar pagamento" });
  }
});

// 🛒 Checkout Pro
app.post("/criar-preferencia", async (req, res) => {
  try {
    const { itens } = req.body;

    const resposta = await preferenceClient.create({
      body: {
        items: itens,
        back_urls: {
          success: "https://artfy.netlify.app/sucesso",
          failure: "https://artfy.netlify.app/erro",
          pending: "https://artfy.netlify.app/pendente",
        },
        auto_return: "approved",
      },
    });

    res.json({ init_point: resposta.init_point });
  } catch (error) {
    console.error("❌ Erro ao criar preferência:", error?.message || error);
    res.status(500).json({ error: "Erro ao criar preferência" });
  }
});

// 🔐 Link de download protegido
app.get("/link-download/:id", (req, res) => {
  const id = req.params.id;
  const registro = pagamentos[id];

  if (!registro) {
    return res.status(404).json({ erro: "Pagamento não encontrado." });
  }

  if (registro.status !== "approved") {
    return res.status(403).json({ erro: "Pagamento ainda não foi aprovado." });
  }

  const agora = Date.now();
  const expirado = agora - registro.criadoEm > 10 * 60 * 1000;
  if (expirado) {
    return res.status(410).json({ erro: "Link expirado." });
  }

  return res.json({ link: registro.link });
});

// 🚀 Start
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
