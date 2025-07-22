import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MercadoPagoConfig, Payment, Preference } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
app.use(express.json());

// CORS
const allowedOrigins = [
  "https://artfy.netlify.app",
  "http://localhost:5173",
  "http://localhost:5174",
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      } else {
        return callback(new Error("CORS origin não permitida"));
      }
    },
  })
);

// Supabase
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Mercado Pago
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const paymentClient = new Payment(mpClient);
const preferenceClient = new Preference(mpClient);

// Teste
app.get("/", (req, res) => {
  res.send("✅ Backend rodando!");
});

// Criar pagamento e salvar no Supabase
app.post("/criar-pagamento", async (req, res) => {
  const { carrinho, nomeCliente, total, email } = req.body;

  console.log("📦 Criando pagamento:", { nomeCliente, total, email });

  let valorTotal = 0;
  if (typeof total === "string") {
    valorTotal = parseFloat(total.replace("R$", "").replace(/\./g, "").replace(",", "."));
  } else if (typeof total === "number") {
    valorTotal = total;
  } else {
    return res.status(400).json({ error: "Formato de total inválido." });
  }

  if (isNaN(valorTotal) || valorTotal <= 0) {
    return res.status(400).json({ error: "Valor total inválido." });
  }

  try {
    // Criar pagamento no Mercado Pago
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
    const paymentId = pagamento.id.toString();

    // 1. Inserir pedido
    const { data: pedidoData, error: pedidoErro } = await supabase
      .from("pedidos")
      .insert([
        {
          payment_id: paymentId,
          email,
          valor_total: valorTotal,
          status: pagamento.status,
        },
      ])
      .select("id")
      .single();

    if (pedidoErro) {
      console.error("Erro ao salvar pedido:", pedidoErro.message);
      return res.status(500).json({ error: "Erro ao salvar pedido no Supabase" });
    }

    const pedidoId = pedidoData.id;

    // 2. Inserir itens do carrinho
    const itensParaInserir = carrinho.map((item) => ({
      pedido_id: pedidoId,
      produto_id: item.id,
      quantidade: item.quantidade || 1,
      preco_unitario: parseFloat(item.preco),
    }));

    const { error: itensErro } = await supabase.from("pedido_itens").insert(itensParaInserir);
    if (itensErro) {
      console.error("Erro ao salvar itens do pedido:", itensErro.message);
    }

    // 3. Retornar dados do QR code
    res.json({
      id: paymentId,
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

// Consultar status de pagamento
app.get("/status-pagamento/:id", async (req, res) => {
  const id = req.params.id;

  try {
    const pagamento = await paymentClient.get({ id });
    res.json({ status: pagamento.status });
  } catch (error) {
    console.error("Erro ao consultar status:", error.message);
    res.status(500).json({ error: "Erro ao consultar pagamento" });
  }
});

// Criar preferência para checkout (ex: cartão)
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

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
