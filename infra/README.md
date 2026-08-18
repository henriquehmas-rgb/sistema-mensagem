# infra — SEEG Omni (sistema-mensagem)

Deploy em VPS Ubuntu 24 com Docker + **Traefik global já existente** (rede
externa `traefik`, wildcard `*.srv1450678.hstgr.cloud`, HTTPS automático).
Host público: `https://chat.srv1450678.hstgr.cloud`.

| Arquivo | Função |
|---|---|
| `docker-compose.yml` | Produção (project name `sistema-mensagem`) |
| `docker-compose.dev.yml` | Dev local: só postgres + redis com portas no host |
| `docker/api.Dockerfile` | NestJS + Prisma (`@sm/api`) |
| `docker/web.Dockerfile` | Next.js standalone (`@sm/web`) |
| `docker/ai.Dockerfile` | FastAPI (`services/ai`) |
| `deploy.sh` | Deploy incremental na VPS |

Roteamento Traefik (mesmo host, prioridade decide):

- `smapi` (priority 20): `/api` e `/socket.io` → api :4000
- `smweb` (priority 10): resto → web :3000
- postgres, redis e ai: **somente** rede `internal` — sem Traefik, sem portas no host.

## 1. Primeira instalação na VPS

```bash
# 1) Clonar no diretório padrão
mkdir -p /docker
git clone <URL_DO_REPO> /docker/sistema-mensagem
cd /docker/sistema-mensagem

# 2) Criar o .env na RAIZ do repo (nunca commitar)
cp .env.example .env

# 3) Gerar os segredos (um comando por variável)
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # JWT_REFRESH_SECRET
openssl rand -hex 32   # APP_ENCRYPTION_KEY
openssl rand -hex 32   # AI_SERVICE_TOKEN
openssl rand -hex 32   # META_VERIFY_TOKEN (qualquer string forte serve)

# Editar o .env:
#  - colar os valores gerados acima
#  - META_APP_SECRET: painel do app na Meta (App Settings > Basic > App Secret)
#  - trocar POSTGRES_PASSWORD (e refletir a senha em DATABASE_URL!)
#  - AI_PROVIDER=mock (sem chave) ou openai|anthropic|google + respectiva API key
nano .env

# 4) Conferir a rede global do Traefik (deve existir) e o nome do entrypoint
docker network inspect traefik >/dev/null && echo "rede traefik OK"
# Os labels do compose assumem entrypoint `websecure`. Confirme o nome real:
docker inspect traefik | grep -i entrypoint
# Se o Traefik da VPS usar outro nome (ex.: `https`), ajuste as duas linhas
# `entrypoints=` no docker-compose.yml — entrypoint errado = 404 silencioso.

# 5) Build + subir tudo
docker compose -f infra/docker-compose.yml --env-file .env up -d --build
docker compose -f infra/docker-compose.yml --env-file .env ps
```

As migrations do Prisma rodam automaticamente no boot do container `api`
(`npx prisma migrate deploy`).

> Contrato com o módulo api: `apps/api/prisma/migrations/` versionado, com a
> migration inicial executando `CREATE EXTENSION IF NOT EXISTS vector`
> (conferido em `000000000000_init/migration.sql`). Sem migrations versionadas,
> `migrate deploy` não cria tabela nenhuma e a API sobe `degraded` (db down).

### Seed inicial (org, admin, stages padrão)

`tsx` está em `dependencies` do `@sm/api` justamente para este comando existir
na imagem de produção (o `api.Dockerfile` verifica isso no build):

```bash
docker compose -f infra/docker-compose.yml --env-file .env exec api npx tsx prisma/seed.ts
```

### Smoke test

```bash
curl -fsS https://chat.srv1450678.hstgr.cloud/api/health
# e no navegador: https://chat.srv1450678.hstgr.cloud (login do painel)
```

## 2. Webhook da Meta (WhatsApp Cloud API / Instagram)

No painel do app Meta (developers.facebook.com > seu app > WhatsApp > Configuration):

- **Callback URL**: `https://chat.srv1450678.hstgr.cloud/api/webhooks/meta`
- **Verify token**: o valor de `META_VERIFY_TOKEN` do `.env`
- Clicar **Verify and save** (a api responde o `hub.challenge` no GET)
- **Webhook fields**: assinar `messages` (WhatsApp Business Account) —
  entrega mensagens recebidas e status `sent/delivered/read`.

O POST do webhook é validado com HMAC SHA-256 (`X-Hub-Signature-256`) usando
`META_APP_SECRET` — se o secret estiver errado, os eventos são rejeitados.

## 3. Apontar um canal (WhatsApp) para o sistema

1. Logar no painel (`https://chat.srv1450678.hstgr.cloud`) como ADMIN.
2. Configurações > Canais > novo canal tipo **WHATSAPP** (equivale a
   `POST /api/v1/channels`), informando as credenciais da Meta:
   - **Access token** (token permanente do system user com `whatsapp_business_messaging`)
   - **phone_number_id** e **WABA id** (painel WhatsApp > API Setup)
3. As credenciais são criptografadas (AES-256-GCM com `APP_ENCRYPTION_KEY`) e
   nunca retornam pela API. Usar `POST /api/v1/channels/:id/test` para validar.
4. O mesmo webhook global atende todos os canais: a api resolve o canal pelo
   `phone_number_id` (`Channel.externalId`) do payload.

## 4. Deploys seguintes

```bash
bash /docker/sistema-mensagem/infra/deploy.sh
```

O script faz: `git pull` → `build` → `up -d` → `ps` → aguarda
`https://chat.srv1450678.hstgr.cloud/api/health` responder (até ~2 min).

## 5. Dev local (sem Docker para os apps)

```bash
docker compose -f infra/docker-compose.dev.yml up -d   # postgres + redis
# no .env local (raiz), aponte para localhost:
#   DATABASE_URL=postgresql://sm:sm@localhost:5432/sm
#   REDIS_URL=redis://localhost:6379
pnpm install && pnpm dev
```

## 6. Operação / Troubleshooting

```bash
# logs
docker compose -f infra/docker-compose.yml --env-file .env logs -f --tail=100 api
docker compose -f infra/docker-compose.yml --env-file .env logs -f web ai

# rebuild de um serviço específico
docker compose -f infra/docker-compose.yml --env-file .env up -d --build api

# psql dentro do container
docker compose -f infra/docker-compose.yml --env-file .env exec postgres psql -U sm -d sm
```

- **404/certificado no domínio**: confira o nome do `certresolver` no Traefik
  global da VPS (`docker inspect traefik` ou o compose do Traefik). Os labels
  usam `letsencrypt`; se o resolver de lá se chamar `mytlschallenge`/`le`,
  ajuste as duas linhas de `tls.certresolver` no `docker-compose.yml`.
- **404 silencioso em TODAS as rotas**: o nome do entrypoint dos routers pode
  não bater com o do Traefik global. Os labels usam `websecure`; verifique com
  `docker inspect traefik | grep -i entrypoint` e ajuste as duas linhas de
  `entrypoints=` no `docker-compose.yml` (router com entrypoint inexistente
  simplesmente não casa — sem erro nos logs).
- **api reiniciando**: quase sempre migration falhando ou `DATABASE_URL`
  incorreta — `docker compose ... logs api` mostra a causa.
- **Extensão pgvector**: a imagem `pgvector/pgvector:pg16` já traz a extensão;
  a migration inicial do Prisma executa `CREATE EXTENSION IF NOT EXISTS vector`.
- **Segurança**: nunca exponha postgres/redis/ai em portas do host em produção;
  o compose deste repo já não expõe.

## 7. Observabilidade (métricas e painel de filas)

Nada de serviço novo no compose — tudo dentro do container `api` (CONTRACTS §14).

### Métricas Prometheus — `GET /api/metrics`

Requer o header `X-Metrics-Token` igual ao valor de `METRICS_TOKEN` do `.env`
(gerar com `openssl rand -hex 32`; **obrigatória em produção** — sem ela a api
não sobe). Formato padrão `prom-client` (texto Prometheus).

```bash
# a partir da VPS (ou de qualquer máquina com acesso ao host):
curl -s https://chat.srv1450678.hstgr.cloud/api/metrics \
  -H "X-Metrics-Token: $METRICS_TOKEN"

# sem o header (ou com o valor errado) → 401
curl -i https://chat.srv1450678.hstgr.cloud/api/metrics
```

Métricas expostas: `http_requests_total` / `http_request_duration_seconds`
(por rota/método/status), `bullmq_queue_jobs` (gauge, por fila/estado —
waiting/active/delayed/failed, atualizado a cada scrape via
`Queue.getJobCounts()`), `ai_reply_duration_seconds` (latência da chamada
api→ia em `/reply`) + métricas default do Node (CPU/memória/event loop).

Para apontar um Prometheus a este endpoint, configurar o header estático no
job do `prometheus.yml`:

```yaml
scrape_configs:
  - job_name: sistema-mensagem-api
    metrics_path: /api/metrics
    authorization:
      type: X-Metrics-Token
    scheme: https
    static_configs:
      - targets: ['chat.srv1450678.hstgr.cloud']
    # Prometheus não suporta header custom nativamente em todas as versões —
    # alternativa: um `authorization.credentials_file`/reverse-proxy que
    # injete o header, ou `params`/`relabel_configs` conforme a versão.
```

### Painel de filas (Bull Board) — `/admin/queues`

Protegido pelo MESMO esquema de autenticação da API (JWT Bearer de um usuário
`ADMIN`) — **não** é uma página de login própria: o painel é uma SPA que só
responde se a requisição já chegar com `Authorization: Bearer <access token
de um ADMIN>`. Login normal do painel (`https://chat.srv1450678.hstgr.cloud`)
não guarda esse header no navegador automaticamente, então o acesso típico é
via terminal (curl) ou uma extensão de navegador que injete o header
(ex.: ModHeader) apontando para a mesma origem.

```bash
# 1) pegar um access token de um usuário ADMIN
TOKEN=$(curl -s https://chat.srv1450678.hstgr.cloud/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@exemplo.com","password":"...","orgSlug":"..."}' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).accessToken')

# 2) usar o token no painel (via extensão de header) OU inspecionar via API:
curl -s https://chat.srv1450678.hstgr.cloud/api/admin/queues/api/queues \
  -H "Authorization: Bearer $TOKEN"

# sem o header, ou usuário sem role ADMIN → 401/403 (nunca abre o painel)
```

Access tokens expiram em 15min (mesma regra do resto da API) — repita o passo
1 quando expirar. Usuário desativado perde acesso em ≤30s (mesma janela do
`UserStatusService` usado no restante da api).
