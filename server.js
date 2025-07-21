require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// Supabase Client
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

// CORS
const allowedOrigins = ["https://artfy.netlify.app", "http://localhost:5173"];
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

// Mercado Pago SDK
const client = new MercadoPagoConfig({ accessToken: process.env.MP_ACCESS_TOKEN });
const payment = new Payment(client);

// Banco em memória (temporário)
const pagamentos = {};

app.get("/", (req, res) => {
  res.send("✅ Backend Mercado Pago rodando!");
});

// 🔧 Criar pagamento PIX com produto vindo do Supabase
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { nomeCliente, email, produtoId } = req.body;

    if (!nomeCliente || !email || !produtoId) {
      return res.status(400).json({ error: "Dados obrigatórios ausentes" });
    }

    // 🔎 Buscar produto no Supabase
    const { data: produto, error } = await supabase
      .from("produtos")
      .select("*")
      .eq("id", produtoId)
      .single();

    if (error || !produto) {
      return res.status(404).json({ error: "Produto não encontrado" });
    }

    console.log("🛍️ Criando pagamento para:", produto.nome, "- Valor:", produto.preco);

    const pagamento = await payment.create({
      body: {
        transaction_amount: produto.preco,
        description: `Compra: ${produto.nome}`,
        payment_method_id: "pix",
        payer: {
          email: "cliente@artfy.com",
          first_name: nomeCliente,
        },
      }
    });

    console.log("✅ Pagamento criado:", pagamento.id);

    const txData = pagamento.point_of_interaction?.transaction_data || {};

    pagamentos[pagamento.id] = {
      status: pagamento.status,
      email,
      nomeCliente,
      criadoEm: Date.now(),
      link: produto.link_download, // 👈 Link real do produto
    };

    res.json({
      id: pagamento.id,
      status: pagamento.status,
      qr_code: txData.qr_code || null,
      qr_code_base64: txData.qr_code_base64 || null,
      ticket_url: txData.ticket_url || null,
    });
  } catch (error) {
    console.error("❌ Erro ao criar pagamento:", error);
    res.status(500).json({ error: "Erro ao criar pagamento", detalhes: error.message });
  }
});

// 🔄 Verificar status de pagamento
app.get("/status-pagamento/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pagamento = await payment.get({ id });

    if (pagamentos[id]) {
      pagamentos[id].status = pagamento.status;
    }

    const txData = pagamento.point_of_interaction?.transaction_data || {};

    res.json({
      id: pagamento.id,
      status: pagamento.status,
      qr_code: txData.qr_code || null,
      qr_code_base64: txData.qr_code_base64 || null,
      ticket_url: txData.ticket_url || null,
      link: pagamentos[id]?.link || null,
    });
  } catch (error) {
    console.error("❌ Erro ao consultar status:", error.message);
    res.status(500).json({ error: "Erro ao consultar pagamento" });
  }
});

// 🔓 Link de download se pagamento aprovado
app.get("/link-download/:id", (req, res) => {
  const { id } = req.params;
  const registro = pagamentos[id];

  if (!registro) {
    return res.status(404).json({ erro: "Pagamento não encontrado." });
  }

  if (registro.status !== "approved") {
    return res.status(403).json({ erro: "Pagamento ainda não foi aprovado." });
  }

  const expirado = Date.now() - registro.criadoEm > 10 * 60 * 1000;
  if (expirado) {
    return res.status(410).json({ erro: "Link expirado." });
  }

  return res.json({ link: registro.link });
});

// 🔔 Webhook (ainda não implementado)
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  console.log("📩 Webhook recebido:", req.body);
  res.status(200).send("OK");
});

// 🔎 Consulta de backup
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

// 🚀 Iniciar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
