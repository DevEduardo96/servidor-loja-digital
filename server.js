require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment } = require("mercadopago"); // ✅ Importação correta para v2.x

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

// ✅ Configuração correta para SDK v2.x
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

// ✅ Instância do Payment usando o client
const payment = new Payment(client);

console.log("✅ Mercado Pago configurado com sucesso!");
console.log("Token carregado:", !!process.env.MP_ACCESS_TOKEN);

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

    console.log("🚀 Criando pagamento PIX para:", nomeCliente, "- Valor:", valorTotal);

    // ✅ Sintaxe correta para SDK v2.x
    const pagamento = await payment.create({
      body: {
        transaction_amount: valorTotal,
        description: "Compra de produtos digitais",
        payment_method_id: "pix",
        payer: {
          email,
          first_name: nomeCliente,
        },
      }
    });

    console.log("✅ Pagamento criado com sucesso! ID:", pagamento.id);

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
    console.error("❌ Erro ao criar pagamento Pix:", error);
    
    // Log mais detalhado do erro
    if (error.cause) {
      console.error("Causa do erro:", error.cause);
    }
    if (error.response?.data) {
      console.error("Dados da resposta:", error.response.data);
    }
    
    res.status(500).json({ 
      error: "Erro ao criar pagamento Pix", 
      detalhes: error.message || error.toString() 
    });
  }
});

// Webhook para receber notificações do Mercado Pago (opcional)
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  try {
    console.log("📩 Webhook recebido:", req.body);
    // Aqui você pode processar as notificações de pagamento
    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Erro no webhook:", error);
    res.status(500).send("Erro interno");
  }
});

// Verificar status de pagamento
app.get("/pagamento/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // Busca o pagamento no Mercado Pago
    const pagamento = await payment.get({ id });
    
    // Atualiza status local se existir
    if (pagamentos[id]) {
      pagamentos[id].status = pagamento.status;
    }
    
    res.json({
      id: pagamento.id,
      status: pagamento.status,
      link: pagamentos[id]?.link || null
    });
  } catch (error) {
    console.error("❌ Erro ao verificar pagamento:", error);
    res.status(500).json({ error: "Erro ao verificar pagamento" });
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});