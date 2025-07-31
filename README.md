# Nectix Backend

Backend Node.js com Express para a plataforma Nectix, integrado com Supabase e Mercado Pago.

## Funcionalidades

- 🔗 **Integração Supabase**: Gerenciamento de produtos
- 💳 **Pagamentos PIX**: Integração completa com Mercado Pago
- 🛡️ **Segurança**: CORS, Helmet e validação robusta
- 📝 **Logs**: Sistema completo de logging
- ⚡ **Performance**: Retry automático e tratamento de erros

## Endpoints da API

### GET /health
Health check do servidor
```json
{
  "status": "ok",
  "timestamp": "2025-07-31T18:30:00.000Z",
  "environment": "production"
}
```

### GET /produtos
Lista todos os produtos disponíveis
```json
[
  {
    "id": 1,
    "name": "Template de Site Profissional",
    "price": 49.9,
    "description": "Template completo...",
    "image_url": "https://...",
    "category": "Templates"
  }
]
```

### POST /criar-pagamento
Cria um pagamento PIX

**Request:**
```json
{
  "produtoId": "1",
  "email": "cliente@email.com"
}
```

**Response:**
```json
{
  "id": "payment_id",
  "status": "pending",
  "qr_code": "codigo_pix_para_copiar",
  "qr_code_base64": "data:image/png;base64,...",
  "ticket_url": "https://..."
}
```

## Deploy no Render

### 1. Preparar o repositório
```bash
# Clone apenas a pasta backend
git clone <seu-repo>
cd backend
```

### 2. Configurar no Render
1. Conecte seu repositório GitHub ao Render
2. Crie um novo Web Service
3. Configure:
   - **Root Directory**: `backend`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`

### 3. Variáveis de ambiente
Configure no painel do Render:

```env
NODE_ENV=production
SUPABASE_URL=https://zsceradvdzzhqynfnchh.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
MERCADO_PAGO_ACCESS_TOKEN=APP_USR-1657711945036221-070520...
FRONTEND_URL=https://your-frontend-domain.com
```

### 4. Deploy automático
O Render fará deploy automaticamente a cada push na branch principal.

## Desenvolvimento Local

### Instalação
```bash
cd backend
npm install
```

### Configuração
```bash
cp .env.example .env
# Edite o arquivo .env com suas credenciais
```

### Executar
```bash
# Desenvolvimento
npm run dev

# Produção local
npm run build
npm start
```

## Estrutura do Projeto

```
backend/
├── src/
│   ├── index.ts          # Servidor principal
│   └── routes.ts         # Rotas da API
├── dist/                 # Build de produção
├── package.json          # Dependências
├── tsconfig.json         # Configuração TypeScript
├── render.yaml           # Configuração do Render
└── README.md            # Este arquivo
```

## Tecnologias

- **Node.js** + **Express**: Framework web
- **TypeScript**: Tipagem estática
- **Supabase**: Database e autenticação
- **Mercado Pago**: Processamento de pagamentos
- **Zod**: Validação de schemas
- **Helmet**: Segurança HTTP
- **CORS**: Cross-origin requests

## Monitoramento

### Logs
Todos os requests são logados com:
- Timestamp
- Método HTTP
- Path
- Status code
- Duração
- Erros (quando aplicável)

### Health Check
Endpoint `/health` para monitoramento do Render:
- Status do servidor
- Timestamp atual
- Ambiente de execução

## Troubleshooting

### Erro "Supabase não configurado"
- Verifique se `SUPABASE_URL` e `SUPABASE_KEY` estão definidas
- Confirme se a URL do Supabase está correta

### Erro "Token do Mercado Pago não configurado para PIX"
- Use um token de produção do Mercado Pago
- Verifique se a conta tem permissões para PIX

### Erro CORS
- Configure `FRONTEND_URL` com o domínio correto
- Adicione domínios adicionais se necessário