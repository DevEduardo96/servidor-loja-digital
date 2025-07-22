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

// Configuração do Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// Configuração do Mercado Pago
const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const preference = new Preference(mp);
const payment = new Payment(mp);

// 🔧 CONFIGURAÇÃO: Configurado para sua tabela 'produtos'
const TABELA_PRODUTOS = 'produtos';
const CAMPO_ID = 'id';
const CAMPO_NOME = 'nome';  
const CAMPO_PRECO = 'preco';
const CAMPO_LINK = 'link_download';

// ✅ Rota de teste
app.get("/", (req, res) => {
  res.send("Servidor funcionando com Supabase e Mercado Pago!");
});

// ... [suas outras rotas de produtos aqui, sem alteração] ...

// 💳 Rota para criar preferência de pagamento (ATUALIZADA para múltiplos itens)
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { email, carrinho } = req.body;

    if (!email || !Array.isArray(carrinho) || carrinho.length === 0) {
      return res.status(400).json({ error: "Email e carrinho são obrigatórios" });
    }

    // Buscar os produtos no banco para garantir os dados atualizados
    const produtosIds = carrinho.map(item => item.id);
    const { data: produtosDb, error: produtosError } = await supabase
      .from(TABELA_PRODUTOS)
      .select('*')
      .in(CAMPO_ID, produtosIds);

    if (produtosError || !produtosDb || produtosDb.length === 0) {
      return res.status(404).json({ error: "Produtos não encontrados" });
    }

    // Mapear os itens para o formato esperado pelo Mercado Pago
    const itemsMP = carrinho.map(item => {
      const produtoInfo = produtosDb.find(p => p[CAMPO_ID] === item.id);
      return {
        id: produtoInfo[CAMPO_ID],
        title: produtoInfo[CAMPO_NOME],
        description: produtoInfo.descricao || `${produtoInfo.categoria} - ${produtoInfo.formato}`,
        quantity: item.quantity,
        unit_price: parseFloat(produtoInfo[CAMPO_PRECO]),
        currency_id: "BRL",
        picture_url: produtoInfo.imagem || null,
        category_id: produtoInfo.categoria
      };
    });

    // Montar metadata com todos os produtos para liberar downloads depois
    const metadataItens = carrinho.map(item => {
      const produtoInfo = produtosDb.find(p => p[CAMPO_ID] === item.id);
      return {
        id: produtoInfo[CAMPO_ID],
        nome: produtoInfo[CAMPO_NOME],
        link_download: produtoInfo[CAMPO_LINK],
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
      },
      payment_methods: {
        installments: 12
      },
      statement_descriptor: "LOJA DIGITAL"
    };

    const preferenceResult = await preference.create({ body });

    res.json({
      init_point: preferenceResult.init_point,
      sandbox_init_point: preferenceResult.sandbox_init_point,
      preference_id: preferenceResult.id
    });

  } catch (err) {
    console.error("Erro ao criar pagamento:", err);
    res.status(500).json({ error: "Erro ao criar pagamento." });
  }
});

// 🎯 Armazenamento temporário dos downloads aprovados (em memória)
const downloadsAprovados = new Map();

// 🔔 Webhook do Mercado Pago (ATUALIZADO para múltiplos produtos)
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === "payment") {
      const paymentId = data.id;

      // Buscar informações do pagamento no MP
      const paymentInfo = await payment.get({ id: paymentId });
      const { status, metadata } = paymentInfo;

      console.log(`Pagamento ${paymentId} - Status: ${status}`);

      // Se pagamento aprovado, liberar download para todos os produtos
      if (status === 'approved' && metadata) {
        const token = generateToken();
        const downloadInfo = {
          cliente_email: metadata.cliente_email,
          produtos: metadata.itens,  // array com todos os produtos comprados
          payment_id: paymentId,
          aprovado_em: new Date(),
          valido_ate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // válido por 7 dias
        };

        downloadsAprovados.set(token, downloadInfo);

        console.log(`✅ Download liberado para ${metadata.cliente_email}:`);
        metadata.itens.forEach(prod => {
          console.log(`   📱 Produto: ${prod.nome}`);
          console.log(`   🔗 Link: ${prod.link_download}`);
        });
        console.log(`   🔑 Token: ${token}`);
        console.log(`   🔗 Link único: ${process.env.BACKEND_URL}/download/${token}`);
      }
    }

    res.status(200).send("OK");
  } catch (err) {
    console.error("Erro no webhook:", err);
    res.status(500).send("Erro interno");
  }
});

// 🔑 Função para gerar token único
function generateToken() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36);
}

// 🔍 Rota para verificar status de pagamento
app.get("/status-pagamento/:id", async (req, res) => {
  try {
    const paymentId = req.params.id;
    const paymentInfo = await payment.get({ id: paymentId });

    const { status, point_of_interaction } = paymentInfo;
    const qr_code_base64 = point_of_interaction?.transaction_data?.qr_code_base64 || null;
    const qr_code = point_of_interaction?.transaction_data?.qr_code || null;

    res.json({ status, qr_code_base64, qr_code });
  } catch (err) {
    console.error("Erro ao buscar status:", err);
    res.status(500).json({ error: "Erro ao verificar status do pagamento." });
  }
});

// 🔽 Rota para obter informações e links de download (RETORNANDO TODOS PRODUTOS)
app.get("/download/:token", async (req, res) => {
  try {
    const token = req.params.token;
    const downloadData = downloadsAprovados.get(token);

    if (!downloadData) {
      return res.status(404).json({ error: "Token inválido ou não encontrado." });
    }

    // Verificar se ainda está válido (7 dias)
    if (new Date() > downloadData.valido_ate) {
      downloadsAprovados.delete(token);
      return res.status(410).json({ error: "Link de download expirado." });
    }

    res.json({
      cliente_email: downloadData.cliente_email,
      produtos: downloadData.produtos,
      pagamento: {
        id: downloadData.payment_id,
        aprovado_em: downloadData.aprovado_em,
        valido_ate: downloadData.valido_ate,
        dias_restantes: Math.ceil((downloadData.valido_ate - new Date()) / (1000 * 60 * 60 * 24))
      }
    });

  } catch (err) {
    console.error("Erro ao obter link:", err);
    res.status(500).json({ error: "Erro ao gerar link de download." });
  }
});

// ... [restante do seu código permanece igual] ...

// 🧹 Função para limpar downloads expirados (executar periodicamente)
function limparDownloadsExpirados() {
  let removidos = 0;
  for (const [token, data] of downloadsAprovados.entries()) {
    if (new Date() > data.valido_ate) {
      downloadsAprovados.delete(token);
      removidos++;
    }
  }
  if (removidos > 0) {
    console.log(`🧹 Removidos ${removidos} downloads expirados`);
  }
}

// Executar limpeza a cada 1 hora
setInterval(limparDownloadsExpirados, 60 * 60 * 1000);

// 🚀 Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📊 Supabase: ${supabaseUrl ? 'Conectado' : 'Não configurado'}`);
  console.log(`💳 Mercado Pago: ${process.env.MP_ACCESS_TOKEN ? 'Configurado' : 'Não configurado'}`);
});
