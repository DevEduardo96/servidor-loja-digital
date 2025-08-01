import express from "express";
import { registerRoutes } from "./routes.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();

// CORS SIMPLIFICADO - PRIMEIRO MIDDLEWARE
app.use((req, res, next) => {
  // Permitir artfy.netlify.app e localhost para desenvolvimento
  const allowedOrigins = [
    "https://artfy.netlify.app",
    "http://localhost:3000",
    "http://localhost:5173"
  ];
  
  const origin = req.headers.origin;
  
  if (!origin || allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin || "https://artfy.netlify.app");
  }
  
  res.header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin,X-Requested-With,Content-Type,Accept,Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  
  // Log para debug
  console.log(`[CORS] ${req.method} ${req.path} from ${origin || 'no-origin'}`);
  
  if (req.method === "OPTIONS") {
    console.log("[CORS] Preflight OK");
    return res.status(200).end();
  }
  
  next();
});

// Middlewares básicos
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

// Middleware de debug para pagamentos
app.use('/api/payments', (req, res, next) => {
  console.log(`[PAYMENTS DEBUG] ${req.method} ${req.path}`);
  console.log('[PAYMENTS DEBUG] Body:', req.body);
  next();
});

// Rota de teste para homepage
app.get("/", (req, res) => {
  res.json({
    message: "🚀 Servidor Loja Digital está rodando!",
    timestamp: new Date().toISOString(),
    cors: "enabled",
    routes: {
      produtos: "GET /produtos",
      pagamento_carrinho: "POST /api/payments/criar-pagamento",
      pagamento_individual: "POST /criar-pagamento",
      test_payments: "GET /api/payments/test"
    }
  });
});

// Middlewares de segurança
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// Log de requisições
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api") || path.startsWith("/")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && res.statusCode >= 400) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 120) {
        logLine = logLine.slice(0, 119) + "…";
      }

      console.log(`[${new Date().toISOString()}] ${logLine}`);
    }
  });

  next();
});

// Endpoint de health check
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    cors: "enabled for artfy.netlify.app"
  });
});

// Registrar rotas da API
registerRoutes(app);

// Middleware de tratamento de erros
app.use(
  (err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error(`[${new Date().toISOString()}] Error:`, err);

    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({
      error: message,
      ...(process.env.NODE_ENV === "development" && { stack: err.stack })
    });
  }
);

// Rota catch-all
app.use("*", (req, res) => {
  console.log(`[404] ${req.method} ${req.originalUrl}`);
  res.status(404).json({
    error: "Endpoint não encontrado",
    path: req.originalUrl,
    method: req.method,
    available_routes: [
      "GET /",
      "GET /health", 
      "GET /produtos",
      "POST /api/payments/criar-pagamento",
      "POST /criar-pagamento",
      "GET /api/payments/test"
    ]
  });
});

// Iniciar servidor
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`[${new Date().toISOString()}] 🚀 Servidor rodando na porta ${port}`);
  console.log(`[${new Date().toISOString()}] 🌍 Ambiente: ${process.env.NODE_ENV || "development"}`);
  console.log(`[${new Date().toISOString()}] 📋 Health check: http://localhost:${port}/health`);
  console.log(`[${new Date().toISOString()}] 🔒 CORS configurado para: https://artfy.netlify.app`);
  console.log(`[${new Date().toISOString()}] 💳 Rota de pagamentos: POST /api/payments/criar-pagamento`);
});