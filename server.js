// === server.js - VERSÃO MELHORADA ===

import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import crypto from "crypto";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { createClient } from "@supabase/supabase-js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middlewares
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting simples
const requestCounts = new Map();
const RATE_LIMIT = 100; // requests por IP por hora
const RATE_WINDOW = 60 * 60 * 1000; // 1 hora

const rateLimit = (req, res, next) => {
  const ip = req.ip || req.connection.remoteAddress;
  const now = Date.now();
  
  if (!requestCounts.has(ip)) {
    requestCounts.set(ip, { count: 1, resetTime: now + RATE_WINDOW });
  } else {
    const data = requestCounts.get(ip);
    if (now > data.resetTime) {
      data.count = 1;
      data.resetTime = now + RATE_WINDOW;
    } else {
      data.count++;
      if (data.count > RATE_LIMIT) {
        return res.status(429).json({ error: "Muitas requisições. Tente novamente em 1 hora." });
      }
    }
  }
  next();
};

app.use(rateLimit);

// Configurações
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const mp = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});

const payment = new Payment(mp);

// Constantes
const TABELA_PRODUTOS = "produtos";
const TABELA_PEDIDOS = "pedidos";
const TABELA_PEDIDO_ITENS = "pedido_itens";
const TABELA_DOWNLOADS = "downloads";

const CAMPO_ID = "id";
const CAMPO_NOME = "nome";
const CAMPO_PRECO = "preco";
const CAMPO_LINK = "link_download";

// Utilitários de validação
const validarEmail = (email) => {
  const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return regex.test(email);
};

const validarCarrinho = (carrinho) => {
  if (!Array.isArray(carrinho) || carrinho.length === 0) {
    return { valido: false, erro: "Carrinho deve conter pelo menos 1 item" };
  }
  
  if (carrinho.length > 50) {
    return { valido: false, erro: "Máximo 50 itens por carrinho" };
  }
  
  for (const item of carrinho) {
    if (!item.id || typeof item.id !== 'number' || item.id <= 0) {
      return { valido: false, erro: "ID do produto inválido" };
    }
    
    if (!item.quantity || typeof item.quantity !== 'number' || item.quantity <= 0 || item.quantity > 100) {
      return { valido: false, erro: "Quantidade deve ser entre 1 e 100" };
    }
  }
  
  return { valido: true };
};

// Validação de assinatura do webhook Mercado Pago
const validarAssinaturaWebhook = (req) => {
  try {
    const xSignature = req.headers['x-signature'];
    const xRequestId = req.headers['x-request-id'];
    const dataID = req.query['data.id'];
    
    if (!xSignature || !xRequestId) {
      console.error("Headers de assinatura ausentes");
      return false;
    }
    
    // Extrair timestamp e hash da assinatura
    const parts = xSignature.split(',');
    let ts, hash;
    
    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key && value) {
        if (key.trim() === 'ts') ts = value;
        if (key.trim() === 'v1') hash = value;
      }
    }
    
    if (!ts || !hash) {
      console.error("Formato de assinatura inválido");
      return false;
    }
    
    // Criar string para validação
    const manifest = `id:${dataID};request-id:${xRequestId};ts:${ts};`;
    
    // Calcular HMAC
    const hmac = crypto
      .createHmac('sha256', process.env.MP_WEBHOOK_SECRET || '')
      .update(manifest)
      .digest('hex');
    
    return hmac === hash;
  } catch (error) {
    console.error("Erro ao validar assinatura do webhook:", error);
    return false;
  }
};

// Logging estruturado
const logger = {
  info: (message, data = {}) => {
    console.log(JSON.stringify({
      level: 'info',
      message,
      data,
      timestamp: new Date().toISOString()
    }));
  },
  error: (message, error = {}, data = {}) => {
    console.error(JSON.stringify({
      level: 'error',
      message,
      error: error.message || error,
      stack: error.stack,
      data,
      timestamp: new Date().toISOString()
    }));
  },
  warn: (message, data = {}) => {
    console.warn(JSON.stringify({
      level: 'warn',
      message,
      data,
      timestamp: new Date().toISOString()
    }));
  }
};

// Função para salvar pedido no banco
const salvarPedido = async (paymentId, email, carrinho, valorTotal) => {
  try {
    // Inserir pedido principal
    const { data: pedido, error: erroPedido } = await supabase
      .from(TABELA_PEDIDOS)
      .insert({
        payment_id: paymentId,
        email,
        valor_total: valorTotal,
        status: 'pendente'
      })
      .select()
      .single();
    
    if (erroPedido) throw erroPedido;
    
    // Inserir itens do pedido
    const itensPedido = carrinho.map(item => ({
      pedido_id: pedido.id,
      produto_id: item.id,
      quantidade: item.quantity,
      preco_unitario: 0 // Será preenchido depois com preço real
    }));
    
    const { error: erroItens } = await supabase
      .from(TABELA_PEDIDO_ITENS)
      .insert(itensPedido);
    
    if (erroItens) throw erroItens;
    
    return pedido;
  } catch (error) {
    logger.error("Erro ao salvar pedido no banco", error, { paymentId, email });
    throw error;
  }
};

// Função para processar pagamento aprovado
const processarPagamentoAprovado = async (pedidoId) => {
  try {
    // Buscar pedido com itens
    const { data: pedido, error: erroPedido } = await supabase
      .from(TABELA_PEDIDOS)
      .select(`
        *,
        pedido_itens (
          produto_id,
          quantidade,
          produtos (*)
        )
      `)
      .eq('id', pedidoId)
      .single();
    
    if (erroPedido || !pedido) {
      throw new Error("Pedido não encontrado");
    }
    
    // Gerar links seguros para downloads
    const linksDownload = [];
    
    for (const item of pedido.pedido_itens) {
      const produto = item.produtos;
      if (!produto || !produto[CAMPO_LINK]) continue;
      
      // Criar link assinado com expiração de 7 dias
      const { data: signedUrlData, error } = await supabase.storage
        .from("produtos")
        .createSignedUrl(produto[CAMPO_LINK], 60 * 60 * 24 * 7); // 7 dias
      
      if (error) {
        logger.error("Erro ao criar signed URL", error, { produtoId: produto.id });
        continue;
      }
      
      const linkData = {
        pedido_id: pedidoId,
        produto_id: produto.id,
        link_temporario: signedUrlData.signedUrl,
        expires_at: new Date(Date.now() + 60 * 60 * 24 * 7 * 1000) // 7 dias
      };
      
      linksDownload.push(linkData);
    }
    
    // Salvar links no banco
    if (linksDownload.length > 0) {
      const { error: erroLinks } = await supabase
        .from(TABELA_DOWNLOADS)
        .insert(linksDownload);
      
      if (erroLinks) {
        logger.error("Erro ao salvar links de download", erroLinks, { pedidoId });
      }
    }
    
    // Atualizar status do pedido
    const { error: erroUpdate } = await supabase
      .from(TABELA_PEDIDOS)
      .update({ status: 'aprovado' })
      .eq('id', pedidoId);
    
    if (erroUpdate) {
      logger.error("Erro ao atualizar status do pedido", erroUpdate, { pedidoId });
    }
    
    logger.info("Pagamento processado com sucesso", { pedidoId, linksCount: linksDownload.length });
    
  } catch (error) {
    logger.error("Erro ao processar pagamento aprovado", error, { pedidoId });
    throw error;
  }
};

// ROTAS

app.post("/criar-pagamento", async (req, res) => {
  try {
    const { email, carrinho } = req.body;
    
    // Validações
    if (!email || !validarEmail(email)) {
      return res.status(400).json({ error: "Email válido é obrigatório" });
    }
    
    const validacaoCarrinho = validarCarrinho(carrinho);
    if (!validacaoCarrinho.valido) {
      return res.status(400).json({ error: validacaoCarrinho.erro });
    }
    
    logger.info("Iniciando criação de pagamento", { email, itensCount: carrinho.length });
    
    // Buscar produtos no Supabase (otimizado - uma query)
    const produtosIds = carrinho.map((item) => item.id);
    const { data: produtosDb, error } = await supabase
      .from(TABELA_PRODUTOS)
      .select("*")
      .in(CAMPO_ID, produtosIds);
    
    if (error) {
      logger.error("Erro ao buscar produtos", error, { produtosIds });
      return res.status(500).json({ error: "Erro ao buscar produtos" });
    }
    
    if (!produtosDb || produtosDb.length === 0) {
      return res.status(404).json({ error: "Produtos não encontrados" });
    }
    
    // Verificar se todos os produtos existem
    const produtosEncontrados = produtosDb.map(p => p[CAMPO_ID]);
    const produtosFaltando = produtosIds.filter(id => !produtosEncontrados.includes(id));
    
    if (produtosFaltando.length > 0) {
      return res.status(404).json({ 
        error: "Alguns produtos não foram encontrados", 
        produtosFaltando 
      });
    }
    
    // Calcular valor total (validação de preços)
    let valorTotal = 0;
    const itensPedido = [];
    
    for (const item of carrinho) {
      const produto = produtosDb.find((p) => p[CAMPO_ID] === item.id);
      const preco = parseFloat(produto[CAMPO_PRECO]);
      
      if (isNaN(preco) || preco <= 0) {
        return res.status(400).json({ 
          error: `Preço inválido para produto ${produto[CAMPO_NOME]}` 
        });
      }
      
      const subtotal = preco * item.quantity;
      valorTotal += subtotal;
      
      itensPedido.push({
        id: produto[CAMPO_ID],
        nome: produto[CAMPO_NOME],
        preco: preco,
        quantidade: item.quantity,
        subtotal: subtotal
      });
    }
    
    // Validar valor total
    if (valorTotal <= 0 || valorTotal > 50000) { // max R$ 50.000
      return res.status(400).json({ error: "Valor total inválido" });
    }
    
    // Criar pagamento PIX no Mercado Pago
    const dadosPagamento = {
      transaction_amount: valorTotal,
      description: `Compra Artfy.store - ${itensPedido.length} item(ns)`,
      payment_method_id: "pix",
      payer: {
        email,
      },
      metadata: {
        cliente_email: email,
        itens_count: carrinho.length,
        valor_total: valorTotal
      },
      notification_url: `${process.env.WEBHOOK_URL}/webhook/mercadopago`
    };
    
    const pagamento = await payment.create(dadosPagamento);
    
    if (!pagamento.response || !pagamento.response.id) {
      logger.error("Resposta inválida do Mercado Pago", null, { dadosPagamento });
      return res.status(500).json({ error: "Erro ao criar pagamento no Mercado Pago" });
    }
    
    const paymentId = pagamento.response.id;
    const pointOfInteraction = pagamento.response.point_of_interaction;
    
    if (!pointOfInteraction || !pointOfInteraction.transaction_data) {
      logger.error("Dados do PIX não encontrados na resposta", null, { paymentId });
      return res.status(500).json({ error: "Erro ao gerar dados do PIX" });
    }
    
    const qrCodeBase64 = pointOfInteraction.transaction_data.qr_code_base64;
    const qrCode = pointOfInteraction.transaction_data.qr_code;
    
    // Salvar pedido no banco de dados
    await salvarPedido(paymentId, email, carrinho, valorTotal);
    
    logger.info("Pagamento criado com sucesso", { 
      paymentId, 
      email, 
      valorTotal, 
      itensCount: carrinho.length 
    });
    
    res.json({ 
      paymentId, 
      qrCodeBase64, 
      qrCode,
      valorTotal,
      itens: itensPedido
    });
    
  } catch (err) {
    logger.error("Erro ao criar pagamento", err, { email, carrinho });
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Webhook seguro do Mercado Pago
app.post("/webhook/mercadopago", async (req, res) => {
  try {
    logger.info("Webhook recebido", { 
      headers: req.headers, 
      query: req.query,
      body: req.body 
    });
    
    // Validar assinatura do webhook
    if (process.env.MP_WEBHOOK_SECRET && !validarAssinaturaWebhook(req)) {
      logger.warn("Webhook com assinatura inválida", { 
        signature: req.headers['x-signature'],
        requestId: req.headers['x-request-id']
      });
      return res.status(401).send("Assinatura inválida");
    }
    
    const { type, data } = req.body;
    
    if (type === "payment" && data && data.id) {
      const paymentId = data.id;
      
      // Buscar pedido no banco
      const { data: pedido, error: erroPedido } = await supabase
        .from(TABELA_PEDIDOS)
        .select('*')
        .eq('payment_id', paymentId)
        .single();
      
      if (erroPedido || !pedido) {
        logger.warn("Pedido não encontrado para payment_id", { paymentId });
        return res.status(200).send("OK"); // Retorna OK para não reenviar webhook
      }
      
      // Verificar status atual no Mercado Pago
      const paymentInfo = await payment.get({ id: paymentId });
      const status = paymentInfo.response.status;
      
      logger.info("Status do pagamento verificado", { paymentId, status, pedidoId: pedido.id });
      
      if (status === "approved" && pedido.status !== "aprovado") {
        await processarPagamentoAprovado(pedido.id);
        
        logger.info("Pagamento aprovado processado", { 
          paymentId, 
          pedidoId: pedido.id,
          email: pedido.email 
        });
      } else if (status === "rejected" && pedido.status === "pendente") {
        // Marcar como rejeitado
        await supabase
          .from(TABELA_PEDIDOS)
          .update({ status: 'rejeitado' })
          .eq('id', pedido.id);
          
        logger.info("Pagamento rejeitado", { paymentId, pedidoId: pedido.id });
      }
    }
    
    res.status(200).send("OK");
  } catch (err) {
    logger.error("Erro no webhook", err);
    res.status(500).send("Erro interno");
  }
});

// Rota para verificar status do pagamento
app.get("/status-pagamento/:paymentId", async (req, res) => {
  try {
    const paymentId = req.params.paymentId;
    
    if (!paymentId || isNaN(paymentId)) {
      return res.status(400).json({ error: "Payment ID inválido" });
    }
    
    const { data: pedido, error } = await supabase
      .from(TABELA_PEDIDOS)
      .select('*')
      .eq('payment_id', paymentId)
      .single();
    
    if (error || !pedido) {
      return res.status(404).json({ error: "Pagamento não encontrado" });
    }
    
    res.json({
      status: pedido.status,
      email: pedido.email,
      valorTotal: pedido.valor_total,
      criadoEm: pedido.created_at
    });
    
  } catch (err) {
    logger.error("Erro ao verificar status do pagamento", err);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Rota para buscar links de download
app.get("/downloads/:paymentId", async (req, res) => {
  try {
    const paymentId = req.params.paymentId;
    const email = req.query.email; // Validação adicional
    
    if (!paymentId || isNaN(paymentId)) {
      return res.status(400).json({ error: "Payment ID inválido" });
    }
    
    if (!email || !validarEmail(email)) {
      return res.status(400).json({ error: "Email válido é obrigatório" });
    }
    
    // Buscar pedido e validar email
    const { data: pedido, error: erroPedido } = await supabase
      .from(TABELA_PEDIDOS)
      .select('*')
      .eq('payment_id', paymentId)
      .eq('email', email)
      .eq('status', 'aprovado')
      .single();
    
    if (erroPedido || !pedido) {
      return res.status(404).json({ error: "Downloads não disponíveis" });
    }
    
    // Buscar links de download válidos
    const { data: downloads, error: erroDownloads } = await supabase
      .from(TABELA_DOWNLOADS)
      .select(`
        *,
        produtos (nome, descricao)
      `)
      .eq('pedido_id', pedido.id)
      .gt('expires_at', new Date().toISOString());
    
    if (erroDownloads) {
      logger.error("Erro ao buscar downloads", erroDownloads, { pedidoId: pedido.id });
      return res.status(500).json({ error: "Erro ao buscar downloads" });
    }
    
    if (!downloads || downloads.length === 0) {
      return res.status(404).json({ error: "Links expirados ou não encontrados" });
    }
    
    // Incrementar contador de downloads
    const downloadIds = downloads.map(d => d.id);
    await supabase
      .from(TABELA_DOWNLOADS)
      .update({ 
        download_count: supabase.rpc('increment_download_count'),
        last_downloaded_at: new Date().toISOString()
      })
      .in('id', downloadIds);
    
    const linksFormatados = downloads.map(download => ({
      nome: download.produtos.nome,
      descricao: download.produtos.descricao,
      url: download.link_temporario,
      expirarEm: download.expires_at,
      downloadCount: download.download_count
    }));
    
    logger.info("Downloads acessados", { 
      paymentId, 
      email, 
      linksCount: linksFormatados.length 
    });
    
    res.json({ 
      links: linksFormatados,
      pedidoId: pedido.id,
      valorTotal: pedido.valor_total
    });
    
  } catch (err) {
    logger.error("Erro ao buscar downloads", err);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
});

// Rota de health check
app.get("/health", (req, res) => {
  res.json({ 
    status: "OK", 
    timestamp: new Date().toISOString(),
    version: "2.0.0"
  });
});

// Middleware de tratamento de erros
app.use((error, req, res, next) => {
  logger.error("Erro não tratado", error, {
    url: req.url,
    method: req.method,
    ip: req.ip
  });
  
  res.status(500).json({ error: "Erro interno do servidor" });
});

// Iniciar servidor
app.listen(PORT, () => {
  logger.info("Servidor iniciado", { port: PORT, env: process.env.NODE_ENV });
});
