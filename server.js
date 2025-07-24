require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MercadoPagoConfig, Payment } = require("mercadopago");
const { produtos } = require("./Produtos");

const app = express();
app.use(express.json());

// CORS configurado apenas uma vez
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

// Armazena pagamentos na memoria
const pagamentos = {};

// Criar pagamento Pix
app.post("/criar-pagamento", async (req, res) => {
  const { carrinho, nomeCliente, email, total } = req.body;

  let valorTotal =
    typeof total === "string"
      ? parseFloat(total.replace("R$", "").replace(/\./g, "").replace(",", "."))
      : total;

  if (isNaN(valorTotal) || valorTotal <= 0) {
    return res.status(400).json({ error: "Valor total inválido." });
  }

  try {
    const pagamento = await paymentClient.create({
      body: {
        transaction_amount: valorTotal,
        payment_method_id: "pix",
        description: "Compra de produtos digitais",
        payer: {
          email: email || "comprador@email.com",
          first_name: nomeCliente,
        },
        // Adiciona URL de notificação (webhook)
        notification_url: `${
          process.env.BASE_URL || "https://seu-servidor.render.com"
        }/webhook`,
      },
    });

    const dados = pagamento.point_of_interaction.transaction_data;

    // Busca links dos produtos no carrinho
    const links = carrinho
      .map((item) => {
        const p = produtos.find((prod) => prod.id === item.id);
        return p ? p.linkDownload : null;
      })
      .filter(Boolean);

    // Salva dados completos do pagamento
    pagamentos[pagamento.id] = {
      status: pagamento.status,
      links,
      criadoEm: Date.now(),
      // Dados adicionais que o frontend precisa
      paymentId: pagamento.id,
      customerEmail: email || "comprador@email.com",
      total: valorTotal * 100, // Frontend espera em centavos
      products: carrinho.map((item) => {
        const p = produtos.find((prod) => prod.id === item.id);
        return {
          id: item.id,
          name: p ? p.nome : "Produto não encontrado",
          downloadUrl: p ? p.linkDownload : null,
          format: "Digital",
          fileSize: "N/A",
        };
      }),
      createdAt: new Date().toISOString(),
      // Dados do carrinho original para referência
      carrinhoOriginal: carrinho,
    };

    console.log(
      `Pagamento criado: ${pagamento.id}, Status: ${pagamento.status}`
    );

    res.json({
      id: pagamento.id,
      status: pagamento.status,
      qr_code_base64: dados.qr_code_base64,
      qr_code: dados.qr_code,
      ticket_url: dados.ticket_url,
    });
  } catch (error) {
    console.error("Erro ao criar pagamento:", error);
    res
      .status(500)
      .json({ error: "Erro ao criar pagamento", detalhes: error.message });
  }
});

// Webhook para receber notificações do Mercado Pago
app.post("/webhook", async (req, res) => {
  try {
    console.log("Webhook recebido:", req.body);

    const { data, type } = req.body;

    if (type === "payment") {
      const paymentId = data.id;
      console.log(`Consultando pagamento: ${paymentId}`);

      // Consulta o pagamento para obter o status atualizado
      const pagamento = await paymentClient.get({ id: paymentId });

      if (pagamentos[paymentId]) {
        pagamentos[paymentId].status = pagamento.status;
        console.log(`Status atualizado para ${paymentId}: ${pagamento.status}`);
      }
    }

    res.status(200).send("OK");
  } catch (error) {
    console.error("Erro no webhook:", error);
    res.status(500).send("Erro");
  }
});

// Consultar status do pagamento
app.get("/status-pagamento/:id", async (req, res) => {
  const id = req.params.id;
  try {
    console.log(`Consultando status do pagamento: ${id}`);

    // Primeiro verifica se tem na memória
    if (pagamentos[id]) {
      console.log(`Status na memória: ${pagamentos[id].status}`);

      // Se ainda está pending, consulta a API do MP para ter certeza
      if (pagamentos[id].status === "pending") {
        try {
          const pagamento = await paymentClient.get({ id });
          pagamentos[id].status = pagamento.status;
          console.log(`Status atualizado da API: ${pagamento.status}`);
        } catch (apiError) {
          console.error("Erro ao consultar API do MP:", apiError.message);
          // Continua com o status da memória se a API falhar
        }
      }

      // Retorna todos os dados que o frontend espera
      const registro = pagamentos[id];
      const responseData = {
        status: registro.status,
        paymentId: registro.paymentId,
        products: registro.products,
        customerEmail: registro.customerEmail,
        total: registro.total,
        createdAt: registro.createdAt,
        temLinks: registro.links && registro.links.length > 0,
      };

      console.log(
        `📤 Enviando resposta para frontend:`,
        JSON.stringify(responseData, null, 2)
      );
      res.json(responseData);
    } else {
      console.log(`❌ Pagamento ${id} não encontrado na memória`);
      // Se não tem na memória, consulta a API
      const pagamento = await paymentClient.get({ id });
      const responseData = {
        status: pagamento.status,
        paymentId: id,
        products: [],
        customerEmail: "N/A",
        total: 0,
        createdAt: new Date().toISOString(),
        temLinks: false,
      };

      console.log(
        `📤 Enviando resposta da API para frontend:`,
        JSON.stringify(responseData, null, 2)
      );
      res.json(responseData);
    }
  } catch (error) {
    console.error("Erro ao consultar pagamento:", error.message);
    res.status(500).json({
      error: "Erro ao consultar pagamento",
      detalhes: error.message,
    });
  }
});

// Liberar links após aprovação
app.get("/link-download/:id", (req, res) => {
  const id = req.params.id;
  const registro = pagamentos[id];

  console.log(`Solicitação de download para: ${id}`);
  console.log(`Registro encontrado:`, JSON.stringify(registro, null, 2));

  if (!registro) {
    return res.status(404).json({ erro: "Pagamento não encontrado." });
  }

  if (registro.status !== "approved") {
    return res.status(403).json({
      erro: "Pagamento não aprovado.",
      status: registro.status,
    });
  }

  // Opcional: expira o link após 10 minutos
  if (Date.now() - registro.criadoEm > 10 * 60 * 1000) {
    return res.status(410).json({ erro: "Link expirado." });
  }

  console.log(`Links liberados para: ${id}`, registro.links);
  return res.json({
    links: registro.links,
    // Debug info
    debug: {
      totalLinks: registro.links.length,
      produtos: registro.products.length,
      status: registro.status,
    },
  });
});

// Endpoint para debug (remover em produção)
app.get("/debug/pagamentos", (req, res) => {
  console.log("📊 Pagamentos na memória:", JSON.stringify(pagamentos, null, 2));
  res.json({
    totalPagamentos: Object.keys(pagamentos).length,
    pagamentos: pagamentos,
  });
});

// Endpoint para debug específico
app.get("/debug/pagamento/:id", (req, res) => {
  const id = req.params.id;
  const registro = pagamentos[id];
  console.log(`🔍 Debug pagamento ${id}:`, JSON.stringify(registro, null, 2));
  res.json({
    encontrado: !!registro,
    dados: registro || null,
  });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
  console.log(
    `Webhook URL: ${
      process.env.BASE_URL || "https://seu-servidor.render.com"
    }/webhook`
  );
});
