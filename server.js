require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const produtos = require("./Produtos");

const app = express();
app.use(cors());
app.use(express.json());

const allowedOrigins = ["https://artfy.netlify.app", "http://localhost:5173"];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS origin não permitida"));
    },
  })
);

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});
const paymentClient = new Payment(mpClient);

// Armazena pagamentos em memória
const pagamentos = {};

// Criar pagamento Pix
app.post("/criar-pagamento", async (req, res) => {
  const { carrinho, nomeCliente, email, total } = req.body;

  let valorTotal =
    typeof total === "string"
      ? parseFloat(total.replace("R$", "").replace(/\./g, "").replace(",", "."))
      : total;

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

    // Busca links dos produtos no carrinho
    const links = carrinho
      .map((item) => {
        const p = produtos.find((prod) => prod.id === item.id);
        return p ? p.linkDownload : null;
      })
      .filter(Boolean);

    pagamentos[pagamento.id] = {
      status: pagamento.status,
      links,
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
    console.error("Erro ao criar pagamento:", error.message);
    res
      .status(500)
      .json({ error: "Erro ao criar pagamento", detalhes: error.message });
  }
});

// Consultar status do pagamento
app.get("/status-pagamento/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const pagamento = await paymentClient.get({ id });
    if (pagamentos[id]) pagamentos[id].status = pagamento.status;
    res.json({ status: pagamento.status });
  } catch (error) {
    console.error("Erro ao consultar pagamento:", error.message);
    res.status(500).json({ error: "Erro ao consultar pagamento" });
  }
});

// Liberar links após aprovação
app.get("/link-download/:id", (req, res) => {
  const id = req.params.id;
  const registro = pagamentos[id];
  if (!registro)
    return res.status(404).json({ erro: "Pagamento não encontrado." });
  if (registro.status !== "approved")
    return res.status(403).json({ erro: "Pagamento não aprovado." });

  // Opcional: expira o link após 10 minutos
  if (Date.now() - registro.criadoEm > 10 * 60 * 1000) {
    return res.status(410).json({ erro: "Link expirado." });
  }

  return res.json({ links: registro.links });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
