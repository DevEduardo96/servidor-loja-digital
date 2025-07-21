require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// Configurações CORS para origens permitidas
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

// Inicializa Mercado Pago SDK v2
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});
const payment = new Payment(mpClient);

// Inicializa Supabase client com chave de serviço
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Banco temporário em memória para armazenar pagamentos e links
const pagamentos = {};

// Rota simples para teste do backend
app.get("/", (req, res) => {
  res.send("✅ Backend Mercado Pago rodando!");
});

// Criar pagamento PIX e armazenar links dos produtos do carrinho
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { nomeCliente, email, total, carrinho } = req.body;

    if (!nomeCliente || !email || !total || !carrinho || !Array.isArray(carrinho)) {
      return res.status(400).json({ error: "Faltando dados obrigatórios ou carrinho inválido" });
    }

    let valorTotal = typeof total === "string"
      ? parseFloat(total.replace("R$", "").replace(/\./g, "").replace(",", "."))
      : total;

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
          email: "cliente@artfy.com", // evita envio automático ao Mercado Pago
          first_name: nomeCliente,
        },
      }
    });

    console.log("✅ Pagamento criado:", pagamento.id);

    // IDs dos produtos do carrinho
    const ids = carrinho.map(item => item.id);

    // Busca produtos no Supabase para obter os links
    const { data: produtos, error: supaError } = await supabase
      .from("produtos")
      .select("id, link_download")
      .in("id", ids);

    if (supaError) {
      console.error("❌ Erro ao buscar produtos no Supabase:", supaError);
      return res.status(500).json({ error: "Erro ao buscar dados dos produtos" });
    }

    // Array só com os links de download
    const links = produtos.map(p => p.link_download);

    // Armazena os dados do pagamento e links no banco em memória
    pagamentos[pagamento.id] = {
      status: pagamento.status,
      email,
      nomeCliente,
      criadoEm: Date.now(),
      links,
    };

    const txData = pagamento.point_of_interaction?.transaction_data || {};

    res.json({
      id: pagamento.id,
      status: pagamento.status,
      qr_code: txData.qr_code || null,
      qr_code_base64: txData.qr_code_base64 || null,
      ticket_url: txData.ticket_url || null,
    });

  } catch (error) {
    console.error("❌ Erro ao criar pagamento Pix:", error);
    res.status(500).json({ error: "Erro ao criar pagamento Pix" });
  }
});

// Verificar status do pagamento e atualizar dados
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
      links: pagamentos[id]?.links || null,
    });
  } catch (error) {
    console.error("❌ Erro ao consultar status:", error.message);
    res.status(500).json({ error: "Erro ao consultar pagamento" });
  }
});

// Entrega dos links de download após pagamento aprovado e dentro do prazo
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

  return res.json({ links: registro.links });
});

// Webhook opcional para atualizações automáticas de pagamento (não implementado)
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  console.log("📩 Webhook recebido:", req.body);
  res.status(200).send("OK");
});

// Consulta simplificada backup
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
      links: pagamentos[id]?.links || null,
    });
  } catch (error) {
    console.error("❌ Erro ao verificar pagamento:", error.message);
    res.status(500).json({ error: "Erro ao verificar pagamento" });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
