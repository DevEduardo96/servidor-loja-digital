require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment, Preference } = require("mercadopago");

const app = express();
app.use(
  cors({
    origin: "https://artfy.netlify.app", // Substitua pelo seu domínio se necessário
  })
);
app.use(express.json());

// 🧠 Simula um "banco de dados" em memória
const pagamentos = {};

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

    // 🔐 Armazena o status inicial e o link do produto associado a esse pagamento
    pagamentos[pagamento.id] = {
      status: pagamento.status,
      link: "https://exemplo.com/downloads/arquivo.zip", // 🔁 Substitua pelo link real
      criadoEm: Date.now(),
    };

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

    // 🧠 Atualiza o status no armazenamento local
    if (pagamentos[id]) {
      pagamentos[id].status = pagamento.status;
    }

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

// 🔗 Rota protegida para fornecer o link de download após pagamento aprovado
app.get("/link-download/:id", (req, res) => {
  const id = req.params.id;

  const registro = pagamentos[id];

  if (!registro) {
    return res.status(404).json({ erro: "Pagamento não encontrado." });
  }

  if (registro.status !== "approved") {
    return res.status(403).json({ erro: "Pagamento ainda não foi aprovado." });
  }

  // ⏳ Expiração após 10 minutos
  const agora = Date.now();
  const expirado = agora - registro.criadoEm > 10 * 60 * 1000; // 10 min
  if (expirado) {
    return res.status(410).json({ erro: "Link expirado." });
  }

  return res.json({ link: registro.link });
});

// 🚀 Inicializa servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});

