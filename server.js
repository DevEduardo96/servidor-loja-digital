import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MercadoPagoConfig, Payment, Preference } from "mercadopago";

dotenv.config();

const app = express();

// Configuração CORS
const allowedOrigins = ["https://artfy.netlify.app", "http://localhost:5173"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("CORS origin não permitida"));
      }
    },
  })
);

app.use(express.json());

// Simulando banco de dados em memória
const pagamentos = {};

// Inicializa Mercado Pago
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const paymentClient = new Payment(mpClient);
const preferenceClient = new Preference(mpClient);

// Teste
app.get("/", (req, res) => {
  res.send("Backend rodando!");
});

// Criar pagamento Pix
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

    pagamentos[pagamento.id] = {
      status: pagamento.status,
      link: "https://exemplo.com/downloads/arquivo.zip",
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

// Status do pagamento
app.get("/status-pagamento/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const pagamento = await paymentClient.get({ id });

    if (pagamentos[id]) {
      pagamentos[id].status = pagamento.status;
    }

    res.json({ status: pagamento.status });
  } catch (error) {
    console.error("Erro ao consultar status:", error.message);
    res.status(500).json({ error: "Erro ao consultar pagamento" });
  }
});

// Preferência de pagamento
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
    console.error("Erro ao criar preferência:", error.message);
    res.status(500).json({ error: "Erro ao criar preferência" });
  }
});

// Link de download após pagamento aprovado
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
