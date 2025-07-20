require("dotenv").config();
const express = require("express");
const cors = require("cors");
const mercadopago = require("mercadopago");

const app = express();

// Configuração CORS
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

// Banco temporário em memória para pagamentos
// Importante: para produção, use banco persistente e implemente limpeza periódica
const pagamentos = {};

// Endpoint de teste
app.get("/", (req, res) => {
  res.send("✅ Backend Mercado Pago rodando!");
});

// Criar pagamento Pix
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { nomeCliente, email, total } = req.body;

    if (!nomeCliente || !email || !total) {
      return res.status(400).json({ error: "Faltando dados obrigatórios: nomeCliente, email ou total" });
    }

    // Normaliza valor total
    let valorTotal = 0;
    if (typeof total === "string") {
      valorTotal = parseFloat(total.replace("R$", "").replace(/\./g, "").replace(",", "."));
    } else if (typeof total === "number") {
      valorTotal = total;
    }

    if (isNaN(valorTotal) || valorTotal <= 0) {
      return res.status(400).json({ error: "Valor total inválido" });
    }

    // Cria pagamento Pix
    const pagamento = await mercadopago.payment.create({
      transaction_amount: valorTotal,
      description: "Compra de produtos digitais",
      payment_method_id: "pix",
      payer: {
        email,
        first_name: nomeCliente,
      },
    });

    // Guarda dados para consultar depois
    pagamentos[pagamento.body.id] = {
      status: pagamento.body.status,
      email,
      nomeCliente,
      criadoEm: Date.now(),
      link: "https://exemplo.com/downloads/arquivo.zip", // Ajuste para link real
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

// Consultar status do pagamento e retornar QR Code se pendente
app.get("/status-pagamento/:id", async (req, res) => {
  const { id } = req.params;

  if (!id) return res.status(400).json({ error: "ID do pagamento obrigatório" });

  try {
    const pagamento = await mercadopago.payment.get(id);

    if (!pagamento || !pagamento.body) {
      return res.status(404).json({ error: "Pagamento não encontrado" });
    }

    if (!pagamentos[id]) {
      return res.status(404).json({ error: "Pagamento não registrado no sistema" });
    }

    // Atualiza status no objeto local
    pagamentos[id].status = pagamento.body.status;

    const transactionData = pagamento.body.point_of_interaction?.transaction_data || {};

    // Retorna status, qr_code_base64 e link para download se aprovado
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

// Endpoint para retornar link de download seguro, somente se pagamento aprovado e não expirado
app.get("/link-download/:id", (req, res) => {
  const { id } = req.params;
  const registro = pagamentos[id];

  if (!registro) return res.status(404).json({ error: "Pagamento não encontrado." });

  if (registro.status !== "approved") return res.status(403).json({ error: "Pagamento não aprovado." });

  const expiracao = 10 * 60 * 1000; // 10 minutos
  if (Date.now() - registro.criadoEm > expiracao) return res.status(410).json({ error: "Link expirado." });

  return res.json({ link: registro.link });
});

// Middleware para tratamento de erros CORS
app.use((err, req, res, next) => {
  if (err.message.startsWith("CORS origin não permitida")) {
    return res.status(403).json({ error: err.message });
  }
  next(err);
});

// Inicializa servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
