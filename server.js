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

// 📦 Rota para listar produtos com filtros
app.get("/produtos", async (req, res) => {
  try {
    let query = supabase.from(TABELA_PRODUTOS).select('*');
    
    // Filtros opcionais
    const { categoria, destaque, limit } = req.query;
    
    if (categoria) query = query.eq('categoria', categoria);
    if (destaque === 'true') query = query.eq('destaque', true);
    if (limit) query = query.limit(parseInt(limit));
    
    const { data: produtos, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    res.json(produtos);
  } catch (err) {
    console.error("Erro ao buscar produtos:", err);
    res.status(500).json({ error: "Erro ao buscar produtos." });
  }
});

// 📦 Rota para produtos em destaque
app.get("/produtos/destaques", async (req, res) => {
  try {
    const { data: produtos, error } = await supabase
      .from(TABELA_PRODUTOS)
      .select('*')
      .eq('destaque', true)
      .order('avaliacao', { ascending: false })
      .limit(6);

    if (error) throw error;
    res.json(produtos);
  } catch (err) {
    console.error("Erro ao buscar destaques:", err);
    res.status(500).json({ error: "Erro ao buscar produtos em destaque." });
  }
});

// 📦 Rota para buscar por categoria
app.get("/produtos/categoria/:categoria", async (req, res) => {
  try {
    const { data: produtos, error } = await supabase
      .from(TABELA_PRODUTOS)
      .select('*')
      .eq('categoria', req.params.categoria)
      .order('nome');

    if (error) throw error;
    res.json(produtos);
  } catch (err) {
    console.error("Erro ao buscar por categoria:", err);
    res.status(500).json({ error: "Erro ao buscar produtos da categoria." });
  }
});

// 📦 Rota para obter produto específico
app.get("/produtos/:id", async (req, res) => {
  try {
    const { data: produto, error } = await supabase
      .from(TABELA_PRODUTOS)
      .select('*')
      .eq(CAMPO_ID, req.params.id)
      .single();

    if (error) throw error;
    if (!produto) return res.status(404).json({ error: "Produto não encontrado." });

    res.json(produto);
  } catch (err) {
    console.error("Erro ao buscar produto:", err);
    res.status(500).json({ error: "Erro ao buscar produto." });
  }
});

// 💳 Rota para criar preferência de pagamento
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { produto_id, quantidade = 1 } = req.body;

    // Buscar produto na sua tabela do Supabase
    const { data: produto, error: produtoError } = await supabase
      .from(TABELA_PRODUTOS)
      .select('*')
      .eq(CAMPO_ID, produto_id)
      .single();

    if (produtoError || !produto) {
      return res.status(404).json({ error: "Produto não encontrado." });
    }

    // Criar preferência no Mercado Pago
    const body = {
      items: [
        {
          id: produto[CAMPO_ID],
          title: produto[CAMPO_NOME],
          description: produto.descricao || `${produto.categoria} - ${produto.formato}`,
          quantity: quantidade,
          unit_price: parseFloat(produto[CAMPO_PRECO]),
          currency_id: "BRL",
          picture_url: produto.imagem || null,
          category_id: produto.categoria
        }
      ],
      back_urls: {
        success: `${process.env.FRONTEND_URL}/sucesso`,
        failure: `${process.env.FRONTEND_URL}/erro`,
        pending: `${process.env.FRONTEND_URL}/pendente`,
      },
      auto_return: "approved",
      notification_url: `${process.env.BACKEND_URL}/webhook/mercadopago`,
      metadata: {
        produto_id: produto[CAMPO_ID],
        produto_nome: produto[CAMPO_NOME],
        produto_categoria: produto.categoria,
        produto_formato: produto.formato,
        tamanho: produto.tamanho,
        link_download: produto[CAMPO_LINK],
        preco_original: produto.preco_original,
        desconto: produto.desconto,
        quantidade: quantidade
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

// 🔔 Webhook do Mercado Pago
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    const { type, data } = req.body;

    if (type === "payment") {
      const paymentId = data.id;
      
      // Buscar informações do pagamento no MP
      const paymentInfo = await payment.get({ id: paymentId });
      const { status, metadata } = paymentInfo;

      console.log(`Pagamento ${paymentId} - Status: ${status}`);

      // Se pagamento aprovado, liberar download
      if (status === 'approved' && metadata) {
        const token = generateToken();
        const downloadInfo = {
          produto_id: metadata.produto_id,
          produto_nome: metadata.produto_nome,
          categoria: metadata.produto_categoria,
          formato: metadata.produto_formato,
          tamanho: metadata.tamanho,
          link_download: metadata.link_download,
          preco_original: metadata.preco_original,
          desconto: metadata.desconto,
          payment_id: paymentId,
          aprovado_em: new Date(),
          valido_ate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 dias
        };

        downloadsAprovados.set(token, downloadInfo);

        console.log(`✅ Download liberado:`);
        console.log(`   📱 Produto: ${downloadInfo.produto_nome}`);
        console.log(`   🏷️ Categoria: ${downloadInfo.categoria}`);
        console.log(`   📄 Formato: ${downloadInfo.formato}`);
        console.log(`   🔑 Token: ${token}`);
        console.log(`   🔗 Link: ${process.env.BACKEND_URL}/download/${token}`);
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

// 🔽 Rota para obter informações e link de download
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
      produto: {
        id: downloadData.produto_id,
        nome: downloadData.produto_nome,
        categoria: downloadData.categoria,
        formato: downloadData.formato,
        tamanho: downloadData.tamanho
      },
      download: {
        link: downloadData.link_download,
        aprovado_em: downloadData.aprovado_em,
        valido_ate: downloadData.valido_ate,
        dias_restantes: Math.ceil((downloadData.valido_ate - new Date()) / (1000 * 60 * 60 * 24))
      },
      pagamento: {
        id: downloadData.payment_id,
        preco_original: downloadData.preco_original,
        desconto: downloadData.desconto
      }
    });

  } catch (err) {
    console.error("Erro ao obter link:", err);
    res.status(500).json({ error: "Erro ao gerar link de download." });
  }
});

// 📊 Rota para estatísticas dos produtos
app.get("/estatisticas", async (req, res) => {
  try {
    const { data: produtos, error } = await supabase
      .from(TABELA_PRODUTOS)
      .select('categoria, destaque, preco, desconto');

    if (error) throw error;

    const stats = {
      total_produtos: produtos.length,
      produtos_destaque: produtos.filter(p => p.destaque).length,
      categorias: [...new Set(produtos.map(p => p.categoria))],
      downloads_ativos: downloadsAprovados.size,
      preco_medio: produtos.reduce((acc, p) => acc + parseFloat(p.preco || 0), 0) / produtos.length
    };

    res.json(stats);
  } catch (err) {
    console.error("Erro ao buscar estatísticas:", err);
    res.status(500).json({ error: "Erro ao buscar estatísticas." });
  }
});

// 📊 Rota para listar downloads ativos (administração)
app.get("/admin/downloads", (req, res) => {
  const ativos = Array.from(downloadsAprovados.entries()).map(([token, data]) => ({
    token,
    produto: {
      id: data.produto_id,
      nome: data.produto_nome,
      categoria: data.categoria,
      formato: data.formato
    },
    pagamento_id: data.payment_id,
    aprovado_em: data.aprovado_em,
    valido_ate: data.valido_ate,
    dias_restantes: Math.ceil((data.valido_ate - new Date()) / (1000 * 60 * 60 * 24)),
    expirado: new Date() > data.valido_ate
  }));

  res.json({ 
    total_downloads: ativos.length,
    downloads_validos: ativos.filter(d => !d.expirado).length,
    downloads_expirados: ativos.filter(d => d.expirado).length,
    downloads: ativos.sort((a, b) => new Date(b.aprovado_em) - new Date(a.aprovado_em))
  });
});

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
