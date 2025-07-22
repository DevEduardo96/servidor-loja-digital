require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { createClient } = require("@supabase/supabase-js");

const app = express();

// Configurações CORS para origens permitidas
const allowedOrigins = [
  "https://artfy.netlify.app",
  "http://localhost:5173",
  "http://localhost:3000",
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

// Inicializa Mercado Pago SDK v2
const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});
const payment = new Payment(mpClient);

// Inicializa Supabase client com chave de serviço
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Função para gerar token único
function generateDownloadToken() {
  return require('crypto').randomBytes(32).toString('hex');
}

// Rota simples para teste do backend
app.get("/", (req, res) => {
  res.json({ 
    message: "✅ Backend Mercado Pago + Supabase rodando!",
    timestamp: new Date().toISOString()
  });
});

// Criar pagamento PIX e armazenar no Supabase
app.post("/criar-pagamento", async (req, res) => {
  try {
    const { nomeCliente, email, total, carrinho } = req.body;

    console.log("📦 Dados recebidos:", { nomeCliente, email, total, carrinho: carrinho?.length });

    if (!nomeCliente || !email || !total || !carrinho || !Array.isArray(carrinho)) {
      return res.status(400).json({ error: "Faltando dados obrigatórios ou carrinho inválido" });
    }

    let valorTotal = typeof total === "string"
      ? parseFloat(total.replace("R$", "").replace(/\./g, "").replace(",", "."))
      : total;

    if (isNaN(valorTotal) || valorTotal <= 0) {
      return res.status(400).json({ error: "Valor total inválido" });
    }

    console.log("🚀 Criando pagamento PIX para:", nomeCliente, "- Valor:", valorTotal);

    // 1. Criar ou buscar cliente no Supabase
    let customerId;
    
    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', email)
      .single();

    if (existingCustomer) {
      customerId = existingCustomer.id;
      console.log('👤 Cliente existente encontrado:', customerId);
    } else {
      const { data: newCustomer, error: customerError } = await supabase
        .from('customers')
        .insert({
          name: nomeCliente,
          email: email,
        })
        .select('id')
        .single();

      if (customerError) {
        console.error('❌ Erro ao criar cliente:', customerError);
        throw customerError;
      }

      customerId = newCustomer.id;
      console.log('👤 Novo cliente criado:', customerId);
    }

    // 2. Criar pedido no Supabase
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert({
        customer_id: customerId,
        total_amount: valorTotal,
        status: 'pending',
      })
      .select('id')
      .single();

    if (orderError) {
      console.error('❌ Erro ao criar pedido:', orderError);
      throw orderError;
    }

    console.log('📦 Pedido criado:', order.id);

    // 3. Buscar produtos no Supabase
    const productIds = carrinho.map(item => item.id);
    const { data: produtos, error: produtosError } = await supabase
      .from('produtos')
      .select('id, nome, preco, link_download')
      .in('id', productIds);

    if (produtosError) {
      console.error('❌ Erro ao buscar produtos:', produtosError);
      throw produtosError;
    }

    // 4. Criar itens do pedido
    const orderItems = carrinho.map(item => {
      const produto = produtos.find(p => p.id === item.id);
      return {
        order_id: order.id,
        product_id: item.id,
        quantity: item.quantity || 1,
        unit_price: produto?.preco || item.price,
      };
    });

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems);

    if (itemsError) {
      console.error('❌ Erro ao criar itens do pedido:', itemsError);
      throw itemsError;
    }

    console.log('📋 Itens do pedido criados:', orderItems.length);

    // 5. Criar pagamento no Mercado Pago
    const pagamentoMP = await payment.create({
      body: {
        transaction_amount: valorTotal,
        description: `Pedido ${order.id} - ${carrinho.length} produto(s)`,
        payment_method_id: "pix",
        payer: {
          email: email,
          first_name: nomeCliente.split(' ')[0],
          last_name: nomeCliente.split(' ').slice(1).join(' ') || nomeCliente.split(' ')[0],
        },
        external_reference: order.id,
        notification_url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/webhook`,
      }
    });

    console.log("✅ Pagamento MP criado:", pagamentoMP.id);

    // 6. Atualizar pedido com ID do pagamento
    const { error: updateError } = await supabase
      .from('orders')
      .update({ mercadopago_payment_id: pagamentoMP.id })
      .eq('id', order.id);

    if (updateError) {
      console.error('❌ Erro ao atualizar pedido:', updateError);
      throw updateError;
    }

    const txData = pagamentoMP.point_of_interaction?.transaction_data || {};

    res.json({
      id: pagamentoMP.id,
      status: pagamentoMP.status,
      order_id: order.id,
      qr_code: txData.qr_code || null,
      qr_code_base64: txData.qr_code_base64 || null,
      ticket_url: txData.ticket_url || null,
    });

  } catch (error) {
    console.error("❌ Erro ao criar pagamento:", error);
    res.status(500).json({ 
      error: "Erro ao criar pagamento",
      message: error.message 
    });
  }
});

// Verificar status do pagamento
app.get("/status-pagamento/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log("🔍 Consultando status do pagamento:", id);

    // Buscar no Mercado Pago
    const pagamentoMP = await payment.get({ id });
    
    // Buscar pedido no Supabase
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        customers (*),
        order_items (*, produtos (*))
      `)
      .eq('mercadopago_payment_id', id)
      .single();

    if (orderError && orderError.code !== 'PGRST116') {
      console.error('❌ Erro ao buscar pedido:', orderError);
    }

    // Atualizar status no Supabase se necessário
    if (order && order.status !== pagamentoMP.status) {
      await supabase
        .from('orders')
        .update({ 
          status: pagamentoMP.status,
          payment_method: pagamentoMP.payment_method_id,
          updated_at: new Date().toISOString()
        })
        .eq('id', order.id);
    }

    const txData = pagamentoMP.point_of_interaction?.transaction_data || {};

    res.json({
      id: pagamentoMP.id,
      status: pagamentoMP.status,
      order_id: order?.id,
      qr_code: txData.qr_code || null,
      qr_code_base64: txData.qr_code_base64 || null,
      ticket_url: txData.ticket_url || null,
    });

  } catch (error) {
    console.error("❌ Erro ao consultar status:", error);
    res.status(500).json({ 
      error: "Erro ao consultar pagamento",
      message: error.message 
    });
  }
});

// Obter links de download após pagamento aprovado
app.get("/link-download/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    console.log("📥 Solicitando links de download para pagamento:", id);

    // Buscar pedido pelo payment_id
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        *,
        customers (*),
        order_items (*, produtos (*))
      `)
      .eq('mercadopago_payment_id', id)
      .single();

    if (orderError) {
      console.error('❌ Pedido não encontrado:', orderError);
      return res.status(404).json({ error: "Pedido não encontrado" });
    }

    if (order.status !== 'approved') {
      return res.status(403).json({ error: "Pagamento ainda não foi aprovado" });
    }

    // Verificar se já existem downloads
    let { data: downloads, error: downloadsError } = await supabase
      .from('downloads')
      .select('download_token, produtos (nome)')
      .eq('order_id', order.id);

    if (downloadsError) {
      console.error('❌ Erro ao buscar downloads:', downloadsError);
      return res.status(500).json({ error: "Erro ao buscar downloads" });
    }

    // Se não existem downloads, criar
    if (!downloads || downloads.length === 0) {
      const downloadInserts = order.order_items.map(item => ({
        order_id: order.id,
        product_id: item.product_id,
        download_token: generateDownloadToken(),
        max_downloads: 3,
        download_count: 0,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
      }));

      const { data: newDownloads, error: insertError } = await supabase
        .from('downloads')
        .insert(downloadInserts)
        .select('download_token, produtos (nome)');

      if (insertError) {
        console.error('❌ Erro ao criar downloads:', insertError);
        return res.status(500).json({ error: "Erro ao criar downloads" });
      }

      downloads = newDownloads;
      console.log('📥 Downloads criados:', downloads.length);
    }

    // Gerar links de download
    const links = downloads.map(download => ({
      name: download.produtos.nome,
      url: `${process.env.BACKEND_URL || 'http://localhost:3001'}/download/${download.download_token}`,
    }));

    res.json({ 
      links,
      customer: {
        name: order.customers.name,
        email: order.customers.email
      }
    });

  } catch (error) {
    console.error("❌ Erro ao obter links:", error);
    res.status(500).json({ 
      error: "Erro ao obter links de download",
      message: error.message 
    });
  }
});

// Download de arquivo com token
app.get("/download/:token", async (req, res) => {
  try {
    const { token } = req.params;
    
    console.log("📁 Download solicitado com token:", token);

    // Buscar download pelo token
    const { data: download, error: downloadError } = await supabase
      .from('downloads')
      .select(`
        *,
        produtos (nome, link_download),
        orders (status)
      `)
      .eq('download_token', token)
      .single();

    if (downloadError || !download) {
      return res.status(404).json({ error: "Token inválido" });
    }

    // Verificar se ainda é válido
    const now = new Date();
    const expiresAt = new Date(download.expires_at);

    if (now > expiresAt) {
      return res.status(410).json({ error: "Link expirado" });
    }

    if (download.download_count >= download.max_downloads) {
      return res.status(429).json({ error: "Limite de downloads excedido" });
    }

    if (download.orders.status !== 'approved') {
      return res.status(403).json({ error: "Pagamento não aprovado" });
    }

    // Incrementar contador
    await supabase
      .from('downloads')
      .update({ download_count: download.download_count + 1 })
      .eq('id', download.id);

    console.log("✅ Download autorizado para:", download.produtos.nome);

    // Redirecionar para o arquivo
    res.redirect(download.produtos.link_download);

  } catch (error) {
    console.error("❌ Erro no download:", error);
    res.status(500).json({ 
      error: "Erro no download",
      message: error.message 
    });
  }
});

// Webhook do Mercado Pago
app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    console.log("📩 Webhook recebido do Mercado Pago");
    
    const notification = JSON.parse(req.body.toString());
    
    if (notification.type === 'payment') {
      const paymentId = notification.data.id;
      
      console.log("💳 Processando notificação de pagamento:", paymentId);
      
      // Consultar pagamento no MP
      const pagamentoMP = await payment.get({ id: paymentId });
      
      // Buscar pedido no Supabase
      const { data: order, error: orderError } = await supabase
        .from('orders')
        .select('*')
        .eq('mercadopago_payment_id', paymentId)
        .single();

      if (!orderError && order) {
        // Atualizar status
        await supabase
          .from('orders')
          .update({ 
            status: pagamentoMP.status,
            payment_method: pagamentoMP.payment_method_id,
            updated_at: new Date().toISOString()
          })
          .eq('id', order.id);

        console.log("✅ Status do pedido atualizado:", order.id, "->", pagamentoMP.status);
      }
    }
    
    res.status(200).send("OK");
  } catch (error) {
    console.error("❌ Erro no webhook:", error);
    res.status(500).send("Error");
  }
});

// Rota de backup para consulta simples
app.get("/pagamento/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const pagamentoMP = await payment.get({ id });

    res.json({
      id: pagamentoMP.id,
      status: pagamentoMP.status,
    });
  } catch (error) {
    console.error("❌ Erro ao verificar pagamento:", error);
    res.status(500).json({ 
      error: "Erro ao verificar pagamento",
      message: error.message 
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor Express rodando na porta ${PORT}`);
  console.log(`📍 URL: http://localhost:${PORT}`);
  console.log(`🔗 Webhook URL: http://localhost:${PORT}/webhook`);
});