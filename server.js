import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MercadoPagoConfig, Payment, Preference } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

// === Variáveis de ambiente obrigatórias ===
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

if (!SUPABASE_URL || !SUPABASE_KEY || !MP_ACCESS_TOKEN) {
  throw new Error("❌ SUPABASE_URL, SUPABASE_KEY ou MP_ACCESS_TOKEN ausentes.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const mpClient = new MercadoPagoConfig({ accessToken: MP_ACCESS_TOKEN });

const paymentClient = new Payment(mpClient);
const preferenceClient = new Preference(mpClient);

// === Express setup ===
const app = express();
app.use(express.json());

const allowedOrigins = [
  "https://artfy.netlify.app",
  "http://localhost:5173",
  "http://localhost:5174",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS origin não permitida"));
      }
    },
  })
);

// === Teste de rota ===
app.get("/", (req, res) => {
  res.send("🚀 Backend funcionando!");
});

// === Criar pagamento Pix ===
app.post("/criar-pagamento", async (req, res) => {
  const { carrinho, nomeCliente, total, email } = req.body;

  let valorTotal = 0;
  if (typeof total === "string") {
    valorTotal = parseFloat(
      total.replace("R$", "").replace(/\./g, "").replace(",", ".")
    );
  } else {
    valorTotal = Number(total);
  }

  if (!email || !carrinho || !valorTotal || isNaN(valorTotal)) {
    return res.status(400).json({ error: "Dados inválidos para pagamento." });
  }

  try {
    const pagamento = await paymentClient.create({
      body: {
        transaction_amount: valorTotal,
        payment_method_id: "pix",
        description: "Compra de produtos digitais",
        payer: {
          email,
          first_name: nomeCliente || "Cliente",
        },
      },
    });

    const dadosPix = pagamento.point_of_interaction.transaction_data;
    const paymentId = pagamento.id.toString();

    // === 1. Inserir pedido no Supabase ===
    const { data: pedido, error: erroPedido } = await supabase
      .from("pedidos")
      .insert([
        {
          payment_id: paymentId,
          email,
          valor_total: valorTotal,
          status: "pending",
        },
      ])
      .select()
      .single();

    if (erroPedido) throw erroPedido;

    // === 2. Inserir itens do pedido ===
    const itens = carrinho.map((item) => ({
      pedido_id: pedido.id,
      produto_id: item.product.id,
      quantidade: item.quantity,
      preco_unitario: item.product.price,
    }));

    const { error: erroItens } = await supabase
      .from("pedido_itens")
      .insert(itens);

    if (erroItens) throw erroItens;

    res.json({
      id: paymentId,
      status: pagamento.status,
      qr_code_base64: dadosPix.qr_code_base64,
      qr_code: dadosPix.qr_code,
      ticket_url: dadosPix.ticket_url,
    });
  } catch (error) {
    console.error("❌ Erro ao gerar pagamento:", error);
    res.status(500).json({ error: "Erro ao gerar pagamento." });
  }
});

// === Consultar status do pagamento ===
app.get("/status-pagamento/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const pagamento = await paymentClient.get({ id });

    const novoStatus = pagamento.status;

    const { error: erroStatus } = await supabase
      .from("pedidos")
      .update({ status: novoStatus })
      .eq("payment_id", id);

    if (erroStatus) throw erroStatus;

    res.json({ status: novoStatus });
  } catch (error) {
    console.error("Erro ao verificar status:", error);
    res.status(500).json({ error: "Erro ao verificar status." });
  }
});

// === Gerar preferência Mercado Pago ===
app.post("/criar-preferencia", async (req, res) => {
  const { itens } = req.body;

  try {
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
    console.error("Erro ao criar preferência:", error);
    res.status(500).json({ error: "Erro ao criar preferência." });
  }
});

// === Gerar link de download protegido ===
app.get("/link-download/:id", async (req, res) => {
  const paymentId = req.params.id;

  try {
    const { data: pedido, error } = await supabase
      .from("pedidos")
      .select("id, status")
      .eq("payment_id", paymentId)
      .single();

    if (error || !pedido) {
      return res.status(404).json({ erro: "Pedido não encontrado." });
    }

    if (pedido.status !== "approved") {
      return res.status(403).json({ erro: "Pagamento ainda não aprovado." });
    }

    // Gerar link temporário
    const { data: download, error: erroDownload } = await supabase
      .from("downloads")
      .insert([
        {
          pedido_id: pedido.id,
          produto_id: null, // ou associe a produtos, se necessário
          link_temporario: "https://meusite.com/arquivo.zip",
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutos
        },
      ])
      .select()
      .single();

    if (erroDownload) throw erroDownload;

    res.json({ link: download.link_temporario });
  } catch (error) {
    console.error("Erro ao gerar link:", error);
    res.status(500).json({ erro: "Erro ao gerar link de download." });
  }
});

// === Start server ===
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
});
