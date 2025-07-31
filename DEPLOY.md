# Deploy do Backend Nectix

Este guia detalha como fazer deploy do backend em diferentes plataformas.

## 🚀 Deploy no Render (Recomendado)

### 1. Configuração no Render

1. Acesse [render.com](https://render.com) e faça login
2. Clique em "New" → "Web Service"
3. Conecte seu repositório GitHub
4. Configure:

**Configurações Básicas:**
- **Name**: `nectix-backend`
- **Root Directory**: `backend`
- **Environment**: `Node`
- **Build Command**: `npm install && npm run build`
- **Start Command**: `npm start`

### 2. Variáveis de Ambiente

Configure no painel do Render:

```env
NODE_ENV=production
SUPABASE_URL=https://zsceradvdzzhqynfnchh.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-1657711945036221-070520...
FRONTEND_URL=https://seu-frontend-domain.com
```

### 3. Deploy

O Render fará deploy automaticamente após a configuração.

**URL da API**: `https://nectix-backend.onrender.com`

## ⚡ Deploy no Vercel (Alternativo)

### 1. Instalar Vercel CLI
```bash
npm i -g vercel
```

### 2. Deploy
```bash
cd backend
vercel --prod
```

### 3. Configurar Variáveis
```bash
vercel env add NODE_ENV
vercel env add SUPABASE_URL
vercel env add SUPABASE_KEY
vercel env add MERCADO_PAGO_ACCESS_TOKEN
vercel env add FRONTEND_URL
```

## 🐳 Deploy com Docker

### 1. Dockerfile
Crie um `Dockerfile` na pasta backend:

```dockerfile
FROM node:18-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY dist ./dist

EXPOSE 3000

CMD ["npm", "start"]
```

### 2. Build e Deploy
```bash
# Build da imagem
docker build -t nectix-backend .

# Run local
docker run -p 3000:3000 --env-file .env nectix-backend

# Deploy para registry
docker tag nectix-backend your-registry/nectix-backend
docker push your-registry/nectix-backend
```

## 🔧 Configuração de Produção

### Checklist pré-deploy:

- [ ] Todas as variáveis de ambiente configuradas
- [ ] Build funcionando sem erros (`npm run build`)
- [ ] Tests passando (se existirem)
- [ ] Logs configurados adequadamente
- [ ] CORS configurado para o domínio correto
- [ ] Rate limiting implementado (se necessário)

### Monitoramento:

1. **Health Check**: `GET /health`
2. **Logs**: Monitorar logs da plataforma
3. **Metrics**: Configurar alertas para erros 5xx

### Segurança:

- [ ] Variáveis sensíveis em environment variables
- [ ] Headers de segurança configurados
- [ ] Rate limiting para APIs públicas
- [ ] Input validation em todas as rotas

## 📊 Testes de Produção

### Após o deploy, teste:

```bash
# Health check
curl https://sua-api.onrender.com/health

# Listar produtos
curl https://sua-api.onrender.com/produtos

# Criar pagamento (teste)
curl -X POST https://sua-api.onrender.com/criar-pagamento \
  -H "Content-Type: application/json" \
  -d '{"produtoId": "1", "email": "test@example.com"}'
```

## 🔄 Atualizações

### Deploy automático:
- Push para branch `main` → Deploy automático no Render
- Pull request → Preview deployment (se configurado)

### Deploy manual:
```bash
git push origin main
```

## 🐛 Troubleshooting

### Erro "Cannot find module"
- Verificar se `npm run build` executou corretamente
- Confirmar que todos os imports estão corretos

### Erro de CORS
- Verificar `FRONTEND_URL` nas variáveis de ambiente
- Confirmar que o domínio está correto

### Erro 503 Service Unavailable
- Verificar logs da plataforma
- Confirmar que o servidor está iniciando corretamente
- Verificar se a porta está configurada corretamente

### Timeout na inicialização
- Verificar se as dependências estão sendo instaladas
- Confirmar que o build está funcionando
- Verificar conectividade com Supabase