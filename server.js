require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { default: MercadoPago } = require("mercadopago");

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

// ===== LOGS DE DIAGNÓSTICO =====
console.log("🔍 DIAGNÓSTICO MERCADO PAGO:");
console.log("MP_ACCESS_TOKEN existe?", !!process.env.MP_ACCESS_TOKEN);
console.log("MP_ACCESS_TOKEN valor:", process.env.MP_ACCESS_TOKEN ? "Token carregado" : "UNDEFINED/VAZIO");
console.log("MercadoPago importado:", typeof MercadoPago);
console.log("MercadoPago constructor:", MercadoPago);

// Instancia MercadoPago com token de acesso
const mercadopago = new MercadoPago({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// ===== MAIS LOGS DE DIAGNÓSTICO =====
console.log("mercadopago instância criada:", !!mercadopago);
console.log("mercadopago tipo:", typeof mercadopago);
console.log("mercadopago.payments existe?", !!mercadopago.payments);
console.log("mercadopago.payments tipo:", typeof mercadopago.payments);
if (mercadopago.payments) {
  console.log("mercadopago.payments.create existe?", !!mercadopago.payments.create);
  console.log("mercadopago.payments.create tipo:", typeof mercadopago.payments.create);
} else {
  console.log("❌ mercadopago.payments é undefined!");
}
console.log("Propriedades disponíveis em mercadopago:", Object.keys(mercadopago));

// Banco temporário em memória para armazenar status e links
const pagamentos = {};

app.get("/", (req, res) => {
  res.send("✅ Backend Mercado Pago rodando!");
});

// Criar pagamento Pix
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { nomeCliente, email, total } = req.body;

    if (!nomeCliente || !email || !total) {
      return res.status(400).json({ error: "Faltando dados obrigatórios" });
    }

    // Converter total para número, ex: "R$ 10,00" => 10.00
    let valorTotal = 0;
    if (typeof total === "string") {
      valorTotal = parseFloat(total.replace("R$", "").replace(/\./g, "").replace(",", "."));
    } else if (typeof total === "number") {
      valorTotal = total;
    }

    if (isNaN(valorTotal) || valorTotal <= 0) {
      return res.status(400).json({ error: "Valor total inválido" });
    }

    // ===== LOGS ANTES DO CREATE =====
    console.log("🚨 TENTANDO CRIAR PAGAMENTO:");
    console.log("mercadopago objeto:", mercadopago);
    console.log("mercadopago.payments:", mercadopago.payments);
    console.log("Tipo de mercadopago.payments:", typeof mercadopago.payments);
    
    if (!mercadopago.payments) {
      throw new Error("mercadopago.payments é undefined - verifique a versão do SDK");
    }
    
    if (!mercadopago.payments.create) {
      throw new Error("mercadopago.payments.create é undefined - método não existe");
    }

    // Cria pagamento via SDK Mercado Pago - método correto para versão 2.x
    const pagamento = await mercadopago.payments.create({
      transaction_amount: valorTotal,
      description: "Compra de produtos digitais",
      payment_method_id: "pix",
      payer: {
        email,
        first_name: nomeCliente,
      },
    });

    // Armazena dados temporariamente para controle
    pagamentos[pagamento.id] = {
      status: pagamento.status,
      email,
      nomeCliente,
      criadoEm: Date.now(),
      link: "https://exemplo.com/downloads/arquivo.zip", // ajuste seu link real aqui
    };

    // Dados do QR Code Pix
    const transactionData = pagamento.point_of_interaction?.transaction_data || {};

    res.json({
      id: pagamento.id,
      status: pagamento.status,
      qr_code: transactionData.qr_code || null,
      qr_code_base64: transactionData.qr_code_base64 || null,
      ticket_url: transactionData.ticket_url || null,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento Pix:", error);
    console.error("Stack trace completo:", error.stack);
    res.status(500).json({ error: "Erro ao criar pagamento Pix", detalhes: error.toString() });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log("=".repeat(50));
});