import express from "express";
import { registerRoutes } from "./routes.js";
import dotenv from "dotenv";
dotenv.config();

const app = express();

// Middleware de CORS adequado
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.FRONTEND_URL?.split(",") || [
    "http://localhost:3000",
    "http://localhost:5173",
    "https://artfy.netlify.app"
  ];

  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }

  res.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.header("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.sendStatus(200);
  }

  next();
});

// Rota de teste para homepage (fora do middleware CORS!)
app.get("/", (req, res) => {
  res.send("🚀 Servidor Loja Digital está rodando!");
});

// Middlewares de segurança
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// Middlewares básicos
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: false }));

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
    environment: process.env.NODE_ENV || "development"
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
  res.status(404).json({
    error: "Endpoint não encontrado",
    path: req.originalUrl,
    method: req.method
  });
});

// Iniciar servidor
const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log(`[${new Date().toISOString()}] 🚀 Servidor rodando na porta ${port}`);
  console.log(`[${new Date().toISOString()}] 🌍 Ambiente: ${process.env.NODE_ENV || "development"}`);
  console.log(`[${new Date().toISOString()}] 📋 Health check: http://localhost:${port}/health`);
});
