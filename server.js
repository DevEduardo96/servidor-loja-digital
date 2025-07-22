// === server.js ===

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MercadoPagoConfig, Preference, Payment } from "mercadopago";
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const preference = new Preference(mp);
const payment = new Payment(mp);

const TABELA_PRODUTOS = 'produtos';
const CAMPO_ID = 'id';
const CAMPO_NOME = 'nome';  
const CAMPO_PRECO = 'preco';
const CAMPO_LINK = 'link_download';

// Mapa simples para armazenar os links aprovados por preference_id
const downloadsPorPreferencia = new Map();

app.post("/criar-pagamento", async (req, res) => {
  try {
    const { email, carrinho } = req.body;

    if (!email || !Array.isArray(carrinho) || carrinho.length === 0) {
      return res.status(400).json({ error: "Email e carrinho obrigatórios" });
    }

    const produtosIds = carrinho.map(item => item.id);
    const { data: produtosDb, error } = await supabase
      .from(TABELA_PRODUTOS)
      .select('*')
      .in(CAMPO_ID, produtosIds);

    if (error || !produtosDb) {
      return res.status(404).json({ error: "Erro ao buscar produtos" });
    }

    const itemsMP = carrinho.map(item => {
      const produto = produtosDb.find(p => p[CAMPO_ID] === item.id);
      return {
        id: produto[CAMPO_ID],
        title: produto[CAMPO_NOME],
        quantity: item.quantity,
        unit_price: parseFloat(produto[CAMPO_PRECO]),
        currency_id: "BRL"
      };
    });

    const metadataItens = carrinho.map(item => {
      const produto = produtosDb.find(p => p[CAMPO_ID] === item.id);
      return {
        id: produto[CAMPO_ID],
        nome: produto[CAMPO_NOME],
        link_download: produto[CAMPO_LINK],
        quantidade: item.quantity
      };
    });

    const body = {
      items: itemsMP,
      back_urls: {
        success: `${process.env.FRONTEND_URL}/sucesso`,
        failure: `${process.env.FRONTEND_URL}/erro`,
        pending: `${process.env.FRONTEND_URL}/pendente`,
      },
      auto_return: "approved",
      notification_url: `${process.env.BACKEND_URL}/webhook/mercadopago`,
      metadata: {
        cliente_email: email,
        itens: metadataItens,
        preference_id: Date.now().toString() // fallback
      },
      payment_methods: {
        installments: 12
      },
      statement_descriptor: "LOJA DIGITAL"
    };

    const preferenceResult = await preference.create({ body });

    // Enviar o preference_id para rastrear depois
    res.json({ preference_id: preferenceResult.id });
  } catch (err) {
    console.error("Erro ao criar pagamento:", err);
    res.status(500).json({ error: "Erro ao criar pagamento." });
  }
});

// Webhook simplificado
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type === "payment") {
      const paymentId = data.id;
      const paymentInfo = await payment.get({ id: paymentId });
      const { status, metadata } = paymentInfo;

      if (status === 'approved' && metadata) {
        const preferenceId = metadata.preference_id;
        downloadsPorPreferencia.set(preferenceId, metadata.itens);
        console.log("Pagamento aprovado para:", metadata.cliente_email);
      }
    }
    res.status(200).send("OK");
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.status(500).send("Erro interno");
  }
});

// Rota que retorna os links diretos por preference_id
app.get("/links/:preference_id", (req, res) => {
  const prefId = req.params.preference_id;
  const produtos = downloadsPorPreferencia.get(prefId);

  if (!produtos) {
    return res.status(404).json({ error: "Produtos não encontrados." });
  }

  res.json({ produtos });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
