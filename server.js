require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { createClient } = require("@supabase/supabase-js");

// Configuração Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("Variáveis SUPABASE_URL e SUPABASE_ANON_KEY são obrigatórias.");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Config Mercado Pago
const client = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});
const payment = new Payment(client);

const app = express();

// CORS liberado só para origens seguras
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

// Banco temporário em memória
const pagamentos = {};

// Rota teste
app.get("/", (req, res) => {
  res.send("✅ Backend Mercado Pago rodando!");
});

// Rota criar pagamento PIX para carrinho com vários produtos
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { nomeCliente, email, carrinho, total } = req.body;

    if (!nomeCliente || !email || !carrinho || !Array.isArray(carrinho) || carrinho.length === 0) {
      return res.status(400).json({ error: "Dados obrigatórios ausentes ou inválidos" });
    }

    // Validação do total
    let valorTotal = 0;
    if (typeof total === "string") {
      valorTotal = parseFloat(total.replace("R$", "").replace(/\./g, "").replace(",", "."));
    } else if (typeof total === "number") {
      valorTotal = total;
    }

    if (isNaN(valorTotal) || valorTotal <= 0) {
      return res.status(400).json({ error: "Valor total inválido" });
    }

    // Caso queira validar/corrigir links direto do Supabase:
    // Exemplo de busca para garantir links atualizados
    // (opcional, pode confiar no que vem do frontend)
    /*
    const produtosIds = carrinho.map(item => item.product.id);
    const { data: produtosDB, error } = await supabase
      .from("Produtos")
      .select("id, link_download")
      .in("id", produtosIds);
    if (error) {
      console.error("Erro ao buscar produtos no Supabase:", error);
      return res.status(500).json({ error: "Erro interno ao buscar produtos" });
    }
    */

    // Para simplificar, pega links do carrinho que veio no corpo
    const linksComprados = carrinho.map(item => item.product.link_download).filter(Boolean);

    // Cria pagamento no Mercado Pago
    const pagamento = await payment.create({
      body: {
        transaction_amount: valorTotal,
        description: `Compra de ${carrinho.length} produtos digitais`,
        payment_method_id: "pix",
        payer: {
          email,
          first_name: nomeCliente,
        },
      }
    });

    pagamentos[pagamento.id] = {
      status: pagamento.status,
      email,
      nomeCliente,
      criadoEm: Date.now(),
      links: linksComprados,
    };

    const txData = pagamento.point_of_interaction?.transaction_data || {};

    return res.json({
      id: pagamento.id,
      status: pagamento.status,
      qr_code: txData.qr_code || null,
      qr_code_base64: txData.qr_code_base64 || null,
      ticket_url: txData.ticket_url || null,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento:", error);
    return res.status(500).json({ error: "Erro ao criar pagamento", detalhes: error.message });
  }
});

// Rota para consultar status do pagamento
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
      links: pagamentos[id]?.links || [],
    });
  } catch (error) {
    console.error("Erro ao consultar status:", error.message);
    res.status(500).json({ error: "Erro ao consultar pagamento" });
  }
});

// Rota entrega links após pagamento aprovado
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

// Webhook (opcional)
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  console.log("Webhook recebido:", req.body);
  res.status(200).send("OK");
});

// Inicia servidor
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
