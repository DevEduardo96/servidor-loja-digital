// === server.js ===

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

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

const payment = new Payment(mp);

const TABELA_PRODUTOS = "produtos";
const CAMPO_ID = "id";
const CAMPO_NOME = "nome";
const CAMPO_PRECO = "preco";
const CAMPO_LINK = "link_download";

// Map para armazenar preferência e itens aprovados
const downloadsPorPreferencia = new Map();

app.post("/criar-pagamento", async (req, res) => {
  try {
    const { email, carrinho } = req.body;

    if (!email || !Array.isArray(carrinho) || carrinho.length === 0) {
      return res.status(400).json({ error: "Email e carrinho obrigatórios" });
    }

    // Buscar os produtos no Supabase
    const produtosIds = carrinho.map((item) => item.id);
    const { data: produtosDb, error } = await supabase
      .from(TABELA_PRODUTOS)
      .select("*")
      .in(CAMPO_ID, produtosIds);

    if (error || !produtosDb) {
      return res.status(404).json({ error: "Erro ao buscar produtos" });
    }

    // Somar valor total do carrinho
    let valorTotal = 0;
    carrinho.forEach((item) => {
      const prod = produtosDb.find((p) => p[CAMPO_ID] === item.id);
      valorTotal += parseFloat(prod[CAMPO_PRECO]) * item.quantity;
    });

    // Criar pagamento Pix direto
    const pagamento = await payment.create({
      transaction_amount: valorTotal,
      description: `Compra na Loja - ${email}`,
      payment_method_id: "pix",
      payer: {
        email,
      },
      metadata: {
        cliente_email: email,
        itens: carrinho,
      },
    });

    // Extrair QR Code Base64 e ID da cobrança
    const qrCodeBase64 =
      pagamento.response.point_of_interaction.transaction_data.qr_code_base64;
    const qrCode =
      pagamento.response.point_of_interaction.transaction_data.qr_code;
    const paymentId = pagamento.response.id;

    // Salvar itens para consulta no webhook (map temporário)
    downloadsPorPreferencia.set(paymentId, {
      email,
      itens: carrinho,
    });

    res.json({ paymentId, qrCodeBase64, qrCode });
  } catch (err) {
    console.error("Erro ao criar pagamento:", err);
    res.status(500).json({ error: "Erro ao criar pagamento." });
  }
});

// Webhook para atualizar status do pagamento
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === "payment") {
      const paymentId = data.id;
      const paymentInfo = await payment.get({ id: paymentId });
      const { status, metadata } = paymentInfo.response;

      if (status === "approved" && downloadsPorPreferencia.has(paymentId)) {
        const { email, itens } = downloadsPorPreferencia.get(paymentId);

        // Gerar links assinados para cada produto comprado
        const linksSeguros = [];

        for (const item of itens) {
          // Buscar o produto no Supabase para pegar o arquivo
          const { data: produto } = await supabase
            .from(TABELA_PRODUTOS)
            .select("*")
            .eq(CAMPO_ID, item.id)
            .single();

          if (!produto) continue;

          // Extrair o caminho do arquivo para criar link assinado
          // Supondo que link_download é o caminho no bucket, ex: 'ebooks/ebook1.pdf'
          const caminhoArquivo = produto[CAMPO_LINK];

          const { data: signedUrlData, error } = await supabase.storage
            .from("produtos")
            .createSignedUrl(caminhoArquivo, 60 * 30); // link válido por 30 minutos

          if (error) {
            console.error("Erro ao criar signed URL:", error);
            continue;
          }

          linksSeguros.push({
            nome: produto[CAMPO_NOME],
            url: signedUrlData.signedUrl,
          });
        }

        // Atualizar map com links assinados
        downloadsPorPreferencia.set(paymentId, {
          email,
          links: linksSeguros,
        });

        console.log(`Pagamento aprovado para ${email}, links gerados.`);
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.status(500).send("Erro interno");
  }
});

// Rota para o frontend buscar os links seguros para download
app.get("/links/:paymentId", (req, res) => {
  const paymentId = req.params.paymentId;
  const dados = downloadsPorPreferencia.get(paymentId);

  if (!dados || !dados.links) {
    return res.status(404).json({ error: "Links não disponíveis." });
  }

  res.json({ links: dados.links });
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
