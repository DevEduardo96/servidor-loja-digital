require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { produtos } = require("./Produtos");

const app = express();
app.use(express.json());

// CORS configurado
const allowedOrigins = ["https://artfy.netlify.app", "http://localhost:5173"];
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      return callback(new Error("CORS origin não permitida"));
    },
  })
);

const mpClient = new MercadoPagoConfig({
  accessToken: process.env.MP_ACCESS_TOKEN,
});
const paymentClient = new Payment(mpClient);

// Armazena pagamentos na memória
const pagamentos = {};

// Função para limpar pagamentos antigos (evita vazamento de memória)
setInterval(() => {
  const agora = Date.now();
  const umaHora = 60 * 60 * 1000;

  Object.keys(pagamentos).forEach((id) => {
    if (agora - pagamentos[id].criadoEm > umaHora) {
      console.log(`🗑️ Removendo pagamento antigo: ${id}`);
      delete pagamentos[id];
    }
  });
}, 15 * 60 * 1000); // Executa a cada 15 minutos

// Criar pagamento Pix
app.post("/criar-pagamento", async (req, res) => {
  const { carrinho, nomeCliente, email, total } = req.body;

  console.log("📦 Dados recebidos:", { carrinho, nomeCliente, email, total });

  // Validação de entrada mais robusta
  if (!carrinho || !Array.isArray(carrinho) || carrinho.length === 0) {
    return res.status(400).json({ error: "Carrinho inválido ou vazio." });
  }

  if (!nomeCliente || !email) {
    return res.status(400).json({ error: "Nome e email são obrigatórios." });
  }

  let valorTotal =
    typeof total === "string"
      ? parseFloat(total.replace("R$", "").replace(/\./g, "").replace(",", "."))
      : total;

  if (isNaN(valorTotal) || valorTotal <= 0) {
    return res.status(400).json({ error: "Valor total inválido." });
  }

  try {
    // URL base para webhook
    const baseUrl = process.env.BASE_URL || `https://${req.get("host")}`;

    const pagamento = await paymentClient.create({
      body: {
        transaction_amount: valorTotal,
        payment_method_id: "pix",
        description: "Compra de produtos digitais",
        payer: {
          email: email,
          first_name: nomeCliente,
        },
        notification_url: `${baseUrl}/webhook`,
        // Adiciona ID externo para rastreamento
        external_reference: `loja_${Date.now()}`,
      },
    });

    const dados = pagamento.point_of_interaction.transaction_data;

    // Processa produtos do carrinho
    const links = [];
    const produtosEncontrados = [];

    carrinho.forEach((item, index) => {
      console.log(
        `🔍 Processando item ${index}:`,
        JSON.stringify(item, null, 2)
      );

      let itemId = null;
      let itemName = null;
      let quantity = 1;

      // Múltiplos formatos de carrinho suportados
      if (item.product && item.product.id) {
        itemId = item.product.id;
        itemName = item.product.name || item.product.nome;
        quantity = item.quantity || 1;
      } else if (item.id) {
        itemId = item.id;
        itemName = item.name || item.nome;
        quantity = item.quantity || 1;
      } else if (typeof item === "string") {
        itemId = item;
      }

      if (!itemId) {
        console.log(`❌ ID não encontrado para item:`, item);
        return;
      }

      const produto = produtos.find((prod) => prod.id === itemId);

      if (produto) {
        console.log(`✅ Produto encontrado: ${produto.nome}`);
        links.push(produto.linkDownload);
        produtosEncontrados.push({
          id: produto.id,
          name: produto.nome,
          downloadUrl: produto.linkDownload,
          format: "Digital",
          fileSize: "N/A",
          quantity: quantity,
          price: produto.preco,
        });
      } else {
        console.log(`❌ Produto não encontrado para ID: ${itemId}`);
        produtosEncontrados.push({
          id: itemId,
          name: itemName || `Produto ID: ${itemId}`,
          downloadUrl: null,
          format: "Digital",
          fileSize: "N/A",
          quantity: quantity,
          price: 0,
        });
      }
    });

    // Salva dados do pagamento
    pagamentos[pagamento.id] = {
      status: pagamento.status,
      statusDetail: pagamento.status_detail,
      links: links,
      criadoEm: Date.now(),
      paymentId: pagamento.id,
      customerEmail: email,
      customerName: nomeCliente,
      total: valorTotal,
      totalCentavos: Math.round(valorTotal * 100), // Para compatibilidade
      products: produtosEncontrados,
      createdAt: new Date().toISOString(),
      carrinhoOriginal: carrinho,
      externalReference: `loja_${Date.now()}`,
      // Dados do QR Code
      qrData: {
        qr_code_base64: dados.qr_code_base64,
        qr_code: dados.qr_code,
        ticket_url: dados.ticket_url,
      },
    };

    console.log(`✅ Pagamento criado: ${pagamento.id}`);
    console.log(`📊 Status inicial: ${pagamento.status}`);
    console.log(`🔗 ${links.length} links de download preparados`);

    res.json({
      id: pagamento.id,
      status: pagamento.status,
      qr_code_base64: dados.qr_code_base64,
      qr_code: dados.qr_code,
      ticket_url: dados.ticket_url,
      // Dados adicionais para debug
      debug: {
        linksCount: links.length,
        productsCount: produtosEncontrados.length,
      },
    });
  } catch (error) {
    console.error("❌ Erro ao criar pagamento:", error);
    res.status(500).json({
      error: "Erro ao criar pagamento",
      detalhes: error.message,
    });
  }
});

// Webhook melhorado
app.post("/webhook", async (req, res) => {
  try {
    console.log("🔔 Webhook recebido:", JSON.stringify(req.body, null, 2));

    const { data, type, action } = req.body;

    // Responde rapidamente para o MP
    res.status(200).send("OK");

    if (type === "payment" && data && data.id) {
      const paymentId = data.id;

      // Delay pequeno para evitar condições de corrida
      setTimeout(async () => {
        try {
          console.log(`🔍 Consultando pagamento via webhook: ${paymentId}`);

          const pagamento = await paymentClient.get({ id: paymentId });

          if (pagamentos[paymentId]) {
            const statusAnterior = pagamentos[paymentId].status;
            pagamentos[paymentId].status = pagamento.status;
            pagamentos[paymentId].statusDetail = pagamento.status_detail;
            pagamentos[paymentId].updatedAt = new Date().toISOString();

            console.log(
              `📈 Status atualizado ${paymentId}: ${statusAnterior} → ${pagamento.status}`
            );

            if (pagamento.status === "approved") {
              console.log(`🎉 Pagamento aprovado! ${paymentId}`);
              console.log(
                `🔗 Links disponíveis: ${pagamentos[paymentId].links.length}`
              );
            }
          } else {
            console.log(`⚠️ Pagamento ${paymentId} não encontrado na memória`);
          }
        } catch (error) {
          console.error(
            `❌ Erro ao processar webhook para ${paymentId}:`,
            error.message
          );
        }
      }, 1000); // 1 segundo de delay
    }
  } catch (error) {
    console.error("❌ Erro no webhook:", error);
    res.status(500).send("Erro");
  }
});

// Consultar status do pagamento - VERSÃO MELHORADA
app.get("/status-pagamento/:id", async (req, res) => {
  const id = req.params.id;

  try {
    console.log(`🔍 Consultando status: ${id}`);

    let registro = pagamentos[id];
    let statusAtualizado = false;

    // Se não existe na memória, tenta buscar na API
    if (!registro) {
      console.log(`📡 Pagamento não encontrado na memória, consultando API...`);

      try {
        const pagamento = await paymentClient.get({ id });

        // Cria registro mínimo
        registro = {
          status: pagamento.status,
          statusDetail: pagamento.status_detail,
          paymentId: id,
          products: [],
          customerEmail: "N/A",
          total: pagamento.transaction_amount || 0,
          totalCentavos: Math.round((pagamento.transaction_amount || 0) * 100),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          links: [],
          criadoEm: Date.now(),
        };

        // Salva na memória para próximas consultas
        pagamentos[id] = registro;
        statusAtualizado = true;
      } catch (apiError) {
        console.error(`❌ Erro ao consultar API: ${apiError.message}`);
        return res.status(404).json({
          error: "Pagamento não encontrado",
          status: "not_found",
        });
      }
    }

    // Se existe na memória mas status é pending/in_process, consulta API para atualizar
    if (
      registro &&
      !statusAtualizado &&
      (registro.status === "pending" || registro.status === "in_process")
    ) {
      try {
        console.log(`🔄 Atualizando status via API...`);
        const pagamento = await paymentClient.get({ id });

        const statusAnterior = registro.status;
        registro.status = pagamento.status;
        registro.statusDetail = pagamento.status_detail;
        registro.updatedAt = new Date().toISOString();

        if (statusAnterior !== pagamento.status) {
          console.log(
            `📈 Status atualizado: ${statusAnterior} → ${pagamento.status}`
          );
        }
      } catch (apiError) {
        console.error(`⚠️ Erro ao atualizar via API: ${apiError.message}`);
        // Continua com dados da memória
      }
    }

    // Prepara resposta padronizada
    const responseData = {
      status: registro.status,
      statusDetail: registro.statusDetail,
      paymentId: registro.paymentId || id,
      products: registro.products || [],
      customerEmail: registro.customerEmail || "N/A",
      total: registro.totalCentavos || registro.total * 100 || 0,
      createdAt: registro.createdAt || new Date().toISOString(),
      updatedAt:
        registro.updatedAt || registro.createdAt || new Date().toISOString(),
      hasLinks: registro.links && registro.links.length > 0,
      linksCount: registro.links ? registro.links.length : 0,
    };

    // Log detalhado para debug
    console.log(`📤 Resposta para ${id}:`, {
      status: responseData.status,
      hasLinks: responseData.hasLinks,
      linksCount: responseData.linksCount,
      productsCount: responseData.products.length,
    });

    res.json(responseData);
  } catch (error) {
    console.error(`❌ Erro ao consultar pagamento ${id}:`, error.message);
    res.status(500).json({
      error: "Erro interno do servidor",
      detalhes: error.message,
      status: "error",
    });
  }
});

// Liberar links após aprovação - VERSÃO MELHORADA
app.get("/link-download/:id", async (req, res) => {
  const id = req.params.id;

  try {
    let registro = pagamentos[id];

    // Se não existe na memória, tenta buscar e validar via API
    if (!registro) {
      console.log(`📡 Buscando pagamento na API para download: ${id}`);

      try {
        const pagamento = await paymentClient.get({ id });

        if (pagamento.status !== "approved") {
          return res.status(403).json({
            erro: "Pagamento não aprovado para download",
            status: pagamento.status,
          });
        }

        return res.status(404).json({
          erro: "Links não disponíveis. Pagamento não processado pelo sistema.",
          status: pagamento.status,
        });
      } catch (apiError) {
        return res.status(404).json({
          erro: "Pagamento não encontrado",
        });
      }
    }

    console.log(`🔍 Solicitação download para: ${id}`);
    console.log(`📊 Status atual: ${registro.status}`);

    if (registro.status !== "approved") {
      return res.status(403).json({
        erro: "Pagamento ainda não aprovado",
        status: registro.status,
        statusDetail: registro.statusDetail,
      });
    }

    // Verifica expiração (opcional - 24 horas)
    const tempoExpiracao = 24 * 60 * 60 * 1000; // 24 horas
    if (Date.now() - registro.criadoEm > tempoExpiracao) {
      return res.status(410).json({
        erro: "Links de download expiraram",
      });
    }

    if (!registro.links || registro.links.length === 0) {
      return res.status(404).json({
        erro: "Nenhum link de download disponível",
      });
    }

    console.log(`✅ Liberando ${registro.links.length} links para: ${id}`);

    res.json({
      links: registro.links,
      products: registro.products,
      customerName: registro.customerName,
      total: registro.total,
      downloadedAt: new Date().toISOString(),
      expiresIn: "24 horas",
    });
  } catch (error) {
    console.error(`❌ Erro ao liberar download ${id}:`, error.message);
    res.status(500).json({
      erro: "Erro interno do servidor",
    });
  }
});

// Health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    pagamentosAtivos: Object.keys(pagamentos).length,
  });
});

// Endpoint para debug (remover em produção)
if (process.env.NODE_ENV !== "production") {
  app.get("/debug/pagamentos", (req, res) => {
    const resumo = Object.keys(pagamentos).map((id) => ({
      id,
      status: pagamentos[id].status,
      criadoEm: new Date(pagamentos[id].criadoEm).toISOString(),
      temLinks: pagamentos[id].links.length > 0,
      qtdLinks: pagamentos[id].links.length,
    }));

    res.json({
      totalPagamentos: Object.keys(pagamentos).length,
      resumo: resumo,
    });
  });

  app.get("/debug/pagamento/:id", (req, res) => {
    const id = req.params.id;
    const registro = pagamentos[id];

    res.json({
      encontrado: !!registro,
      dados: registro || null,
    });
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(
    `🔗 Webhook URL: ${
      process.env.BASE_URL || "http://localhost:" + PORT
    }/webhook`
  );

  if (process.env.NODE_ENV !== "production") {
    console.log(`🐛 Debug endpoints disponíveis em modo desenvolvimento`);
  }
});

// Rota para listar pagamentos (admin)
app.get("/admin/pagamentos", (req, res) => {
  const auth = req.headers.authorization;
  if (auth !== "Bearer senha-secreta") {
    return res.status(401).json({ error: "Não autorizado" });
  }

  res.json(Object.values(pagamentos));
});
