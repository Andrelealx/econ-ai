# econ-ai (SaaS Financeiro com IA)

Plataforma SaaS para:
- organizar renda, gastos, orcamentos e metas;
- administrar carteira de investimentos;
- analisar oportunidades de acoes com score quantitativo;
- conversar com um consultor financeiro por IA.
- executar acoes financeiras via chat (ex.: adicionar valor em meta).
- oferecer chat publico para visitantes sem login.

## Stack

- `api`: Node.js + Express + TypeScript + PostgreSQL
- `web`: React + TypeScript + Vite
- IA: OpenAI (`OPENAI_API_KEY`) com fallback local
- Mercado: B3 via `brapi` + fallback `stooq`

## Estrutura

```txt
finance-advisor-saas/
  api/
  web/
  railway.json
  docker-compose.yml
```

## Requisitos

- Node 20+
- Docker (opcional, para subir Postgres local)

## Rodando local

1. Instale dependencias:

```bash
npm install
```

2. Suba Postgres local (opcional):

```bash
docker compose up -d
```

3. Configure ambiente da API:

```bash
cp api/.env.example api/.env
```

Opcional para o frontend (`web/.env`):

```bash
VITE_API_BASE_URL=http://localhost:4010/api
```

Sem essa variavel, o frontend usa:
- dev (`:5173`): `http://localhost:4010/api`
- producao: `window.location.origin/api`

4. Rode migrations e seed:

```bash
npm run migrate
npm run seed
```

5. Rode backend e frontend em terminais separados:

```bash
npm run dev:api
npm run dev:web
```

6. Acesse:
- Web: `http://localhost:5173`
- API: `http://localhost:4010/api/health`

## Chat publico sem login

- Visitantes sem login acessam apenas o chat publico (`/api/public/chat`).
- Dashboard, transacoes, metas, investimentos e acoes em conta exigem autenticacao.

## Endpoints principais

- Publico: `POST /api/public/chat`
- Auth: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- Dashboard: `GET /api/dashboard/summary`
- Financas: `/api/finance/*`
- Investimentos: `/api/investments/*`
- IA: `POST /api/advisor/chat`

## Deploy na Railway (1 servico)

1. Crie um novo projeto no Railway e conecte o repo.
2. Adicione plugin PostgreSQL.
3. Em Variables, configure:
   - `DATABASE_URL` (Railway preenche automaticamente com Postgres)
   - `JWT_SECRET`
   - `OPENAI_API_KEY` (opcional, mas recomendado)
   - `WEB_ORIGIN` com URL publica da app (ex.: `https://seu-app.up.railway.app`)
   - `AUTO_MIGRATE=true`
4. Railway usa `railway.json`:
   - build: `npm install && npm run build`
   - start: `npm run start`
5. Deploy.

A API serve o frontend buildado em `web/dist` automaticamente.

## Observacoes de conformidade

- O radar de oportunidades e o chat sao educacionais.
- Nao ha promessa de retorno ou recomendacao individual de investimento.
- Para operar como consultoria regulada, valide requisitos legais locais.
