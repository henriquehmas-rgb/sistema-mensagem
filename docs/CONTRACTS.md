# CONTRATOS ENTRE MÓDULOS — sistema-mensagem

> **Este arquivo é a fonte da verdade.** Todo módulo (api, web, ai, infra) DEVE seguir
> exatamente estes nomes de entidades, eventos, filas e rotas. Mudanças aqui exigem
> atualização coordenada de todos os módulos.

## 1. Identidade do produto
- Nome de exibição: **SEEG Omni**
- Monorepo pnpm: `@sm/api` (apps/api, NestJS), `@sm/web` (apps/web, Next.js App Router),
  `@sm/shared` (packages/shared, tipos TS), `services/ai` (FastAPI Python).

## 2. Portas e URLs
| Serviço | Porta interna | Exposição |
|---|---|---|
| web (Next.js) | 3000 | Traefik `chat.srv1450678.hstgr.cloud` |
| api (NestJS) | 4000 | Traefik mesmo host, paths `/api`, `/socket.io` |
| ai (FastAPI) | 8100 | **interno apenas** (rede docker) |
| postgres (pgvector/pgvector:pg16) | 5432 | interno |
| redis (redis:7-alpine) | 6379 | interno |

## 3. Entidades (Prisma / PostgreSQL) — TODAS com `orgId` (tenant)
Enums em SCREAMING_CASE. Ids: `cuid()`. Timestamps `createdAt`/`updatedAt` em tudo.

- **Organization**: id, name, slug (unique), plan, settings Json
- **User**: id, orgId, name, email (unique por org), passwordHash, role `Role{ADMIN,SUPERVISOR,AGENT}`, avatarUrl?, isActive, lastSeenAt?
- **Channel**: id, orgId, type `ChannelType{WHATSAPP,INSTAGRAM,WEBCHAT}`, name, status `ChannelStatus{ACTIVE,DISABLED,ERROR}`, config Json (não sensível), encryptedCredentials String (AES-256-GCM base64: tokens Meta, phone_number_id etc.), externalId? (phone_number_id / ig business id)
- **Contact**: id, orgId, name, phone?, email?, avatarUrl?, notes?, customFields Json, unique(orgId, phone)
- **ContactIdentity**: id, orgId, contactId, channelType, externalId (wa_id / ig user id / webchat visitor id), unique(orgId, channelType, externalId)
- **PipelineStage**: id, orgId, name, color, position Int, isHumanHandoff Boolean (coluna de intervenção humana), isDefault Boolean
- **Conversation**: id, orgId, contactId, channelId, status `ConversationStatus{OPEN,PENDING,RESOLVED,SNOOZED}`, assigneeId? (User), stageId? (PipelineStage), stagePosition Float (ordenação no kanban), aiEnabled Boolean default true, unreadCount Int, lastMessageAt?, lastMessagePreview?
- **Message**: id, orgId, conversationId, direction `MessageDirection{INBOUND,OUTBOUND}`, type `MessageType{TEXT,IMAGE,AUDIO,VIDEO,DOCUMENT,STICKER,LOCATION,TEMPLATE,SYSTEM}`, content Json ({text} | {mediaUrl,mimeType,caption,filename} | {templateName,params} | {latitude,longitude}), status `MessageStatus{PENDING,SENT,DELIVERED,READ,FAILED}`, externalId? (wamid, unique por org), authorId? (User que enviou; null = contato ou IA), isAiGenerated Boolean, errorMessage?, index(orgId, conversationId, createdAt)
- **Tag**: id, orgId, name, color, unique(orgId, name)
- **ConversationTag**: conversationId, tagId (m2m)
- **Automation**: id, orgId, name, enabled, trigger Json, conditions Json, actions Json, runCount Int
- **AutomationRun**: id, orgId, automationId, conversationId?, status `RunStatus{SUCCESS,FAILED,SKIPPED}`, log Json, durationMs Int
- **KnowledgeSource**: id, orgId, type `SourceType{PDF,URL,TEXT,TABLE}`, name, status `IngestStatus{PENDING,PROCESSING,READY,FAILED}`, meta Json, chunkCount Int
- **KnowledgeChunk**: id, orgId, sourceId, content Text, embedding vector(1536) — via extensão pgvector (migration SQL manual `CREATE EXTENSION IF NOT EXISTS vector`), index ivfflat/hnsw, **toda query SQL de similaridade DEVE filtrar `WHERE org_id = $1`**
- **RefreshToken**: id, userId, tokenHash, expiresAt, revokedAt?
- **AuditLog**: id, orgId, userId?, action, entity, entityId, meta Json
- **WebhookEventLog**: id, orgId?, source, externalEventId? (dedupe), payload Json, status, index(externalEventId)

## 4. Filas BullMQ (Redis) — prefixo `sm`
| Fila | Payload | Produtor → Consumidor |
|---|---|---|
| `webhook-ingest` | `{ source: 'meta'\|'webchat', body, headers, receivedAt }` | webhook controller → channels processor |
| `message-outbound` | `{ orgId, messageId }` | messages service → sender processor (Meta Graph API) |
| `ai-reply` | `{ orgId, conversationId, messageId }` | channels processor → ai processor (chama FastAPI) |
| `automation-run` | `{ orgId, event: AutomationEvent, context }` | qualquer módulo → automations processor |
| `knowledge-ingest` | `{ orgId, sourceId }` | knowledge controller → chama FastAPI /ingest |

Regras: jobs com `attempts: 3`, backoff exponencial, `removeOnComplete: {count: 1000}`.
Webhook controller responde **200 imediatamente** e só enfileira. Dedupe por `externalEventId`/`wamid` antes de processar.
Job extra na fila `webhook-ingest` (job name `media-fetch`, payload `{orgId, channelId, messageId, mediaId}`):
retry delayed do re-host de mídia inbound WhatsApp (até 3 tentativas) — ao conseguir, atualiza
`Message.content` (`mediaId` → `mediaUrl`) e emite `message:updated`.

## 5. Socket.io — namespace `/rt`, path `/socket.io`
- Auth: JWT no `handshake.auth.token`. Ao conectar, join automático em `org:{orgId}`.
- Adapter: `@socket.io/redis-adapter` (pub/sub) — multi-instância.
- Client→Server: `conversation:join {conversationId}`, `conversation:leave {conversationId}`, `typing {conversationId, isTyping}`
- Server→Client (sempre com payload completo serializado do recurso):
  - `message:new {message, conversation}`
  - `message:updated {message}` (mensagem EXISTENTE com content atualizado — ex.: re-host
    de mídia inbound `mediaId` → `mediaUrl`; clientes fazem patch por id, sem som/toast)
  - `message:status {messageId, conversationId, status}`
  - `conversation:new {conversation}` (inclui contact)
  - `conversation:updated {conversation}` (assignee, stage, status, tags, unread)
  - `conversation:moved {conversationId, stageId, stagePosition, movedBy}`
  - `typing {conversationId, userId?, contactId?, isTyping}`
  - `contact:updated {contact}`
- Emissão SEMPRE via `RealtimeService` (api) — nunca emitir direto de processors; processors chamam RealtimeService que publica no room `org:{orgId}` e/ou `conversation:{id}`.

## 6. API REST — `/api/v1`, JSON, JWT Bearer
Padrão de resposta: recurso direto; listas `{ data, total, page, pageSize }`. Erros: `{ statusCode, message, error }` (Nest padrão).
- `POST /auth/login {email, password, orgSlug?}` → `{accessToken, refreshToken, user}`
- `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`
- `GET/POST/PATCH/DELETE /users` (ADMIN), `GET /users/agents`
- `GET/POST/PATCH /contacts`, `GET /contacts/:id`
- `GET /conversations?status=&assigneeId=&stageId=&tagIds=&channelType=&q=&page=` 
- `GET /conversations/:id`, `PATCH /conversations/:id` (assignee/status/stage/aiEnabled), `POST /conversations/:id/tags`, `DELETE /conversations/:id/tags/:tagId`, `POST /conversations/:id/read`
- `GET /conversations/:id/messages?cursor=` (paginação por cursor, mais recentes primeiro), `POST /conversations/:id/messages {type, content}` → cria PENDING + enfileira `message-outbound`
- `POST /conversations/:id/move {stageId, stagePosition}` (kanban)
- `GET/POST/PATCH/DELETE /stages` (reorder: `POST /stages/reorder {ids[]}`)
- `GET/POST/PATCH/DELETE /tags`
- `GET/POST/PATCH/DELETE /automations`, `GET /automations/:id/runs`
- `GET/POST/PATCH /channels` (credenciais só na criação/edição; nunca retornadas), `POST /channels/:id/test`
- `GET/POST/DELETE /knowledge`, status de ingestão via GET
- `GET /dashboard/metrics` (contadores: abertas, por etapa, por agente, tempo médio resposta)
- **Health público (sem JWT, isento de rate limit, FORA do prefixo `/v1`)**: `GET /api/health` → `{ status: 'ok'|'degraded', db: 'up'|'down', redis: 'up'|'down' }` — sempre HTTP 200; usado pelo healthcheck do Docker (infra/docker-compose.yml) e pelo deploy.sh
- **Webhooks públicos (sem JWT)**: `GET /api/webhooks/meta` (hub.challenge verify), `POST /api/webhooks/meta` (**validar `X-Hub-Signature-256` HMAC SHA-256 com META_APP_SECRET sobre o raw body**; 200 sempre; enfileirar)
- **Webchat público**: `POST /api/webchat/session {orgSlug}` → `{visitorToken, conversationId, orgName}` (**rate limit 10/min** — cria Contact+Conversation reais sem auth); `POST /api/webchat/messages`; `GET /api/webchat/messages?after=`; socket namespace `/webchat` com visitorToken (recebe `message:new {message}`, `message:status` e `typing` do agente; emite `typing {isTyping}` — relayado ao `/rt` como `typing {conversationId, contactId, isTyping}`). Mensagens entregues ao visitante (REST e relay do `/webchat`) SEMPRE com `errorMessage: null` — detalhe interno nunca sai da org (status FAILED basta). Widget embutível: `GET /webchat.js` (loader) + página `/webchat/widget?org=&parent=` (web). **Criação LAZY**: o loader só monta o iframe no primeiro clique na bolha e o widget só chama `POST /session` na PRIMEIRA mensagem do visitante — pageview/abertura nunca criam contato/conversa nem disparam automações. Canal WEBCHAT: `config.orgSlug` é server-autoritativo (a api grava o slug real da org; valor divergente → 400).
- **Mídia re-hospedada (pública, sem JWT, isenta de rate limit, FORA do `/v1`)**: `GET /api/media/:orgId/:arquivo` — serve a mídia inbound baixada da Meta (WhatsApp; env `MEDIA_DIR`, layout `{orgId}/{arquivo}`). Content-Type derivado da extensão (SVG nunca é servido), `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`. Anti path-traversal: regex estrita nos dois segmentos (`orgId` = cuid; arquivo = 32 hex + extensão curta) + resolução absoluta com verificação de prefixo de `MEDIA_DIR` (violação → 400; inexistente → 404). **Segurança MVP**: URL não-adivinhável — nome de arquivo com 128 bits aleatórios (`{hex-128-bits}.{ext}`); o link é o segredo, sem auth adicional. Upload/anexos novos (webchat/agente) permanecem fora de escopo.

## 7. Serviço de IA (FastAPI) — interno, auth header `X-Service-Token: ${AI_SERVICE_TOKEN}`
- `POST /ingest {org_id, source_id, type, content_url?|content_text?, meta}` → processa async, chunking + embeddings + upsert pgvector, callback `PATCH api /internal/knowledge/:id/status` (ou atualiza direto no banco — decisão: **atualiza direto no Postgres**, mesma DATABASE_URL)
- `POST /query {org_id, query, top_k=6}` → `{chunks: [{content, score, source_id}]}` — SEMPRE filtra org_id
- `POST /reply {org_id, conversation_id, messages: [{role, content}], contact: {...}}` → `{reply: str|null, handoff: bool, handoff_reason?, confidence: float, sources: []}`
  - Pipeline: busca semântica (pgvector) → rerank → prompt com guardrails (responder SÓ com base no contexto; se não souber, `handoff=true`) → LLM (env `AI_PROVIDER=openai|anthropic|google|mock`; **mock** = respostas determinísticas p/ dev sem chave)
  - Detecção de intenção de atendimento humano (pedido explícito, frustração, assunto sensível) → `handoff=true`
- `GET /health`

Quando `handoff=true`: api move a conversa para a stage com `isHumanHandoff=true`, desliga `aiEnabled`, emite `conversation:moved` + `conversation:updated`.

## 8. Variáveis de ambiente (`.env` na raiz de infra; `.env.example` versionado)
```
DATABASE_URL=postgresql://sm:sm@postgres:5432/sm
REDIS_URL=redis://redis:6379
JWT_SECRET= JWT_REFRESH_SECRET= APP_ENCRYPTION_KEY= (32 bytes hex)
AI_SERVICE_URL=http://ai:8100  AI_SERVICE_TOKEN=
AI_PROVIDER=mock  OPENAI_API_KEY=  ANTHROPIC_API_KEY=  GOOGLE_API_KEY=
META_APP_SECRET=  META_VERIFY_TOKEN=  META_GRAPH_VERSION=v21.0
PUBLIC_URL=https://chat.srv1450678.hstgr.cloud
NEXT_PUBLIC_API_URL=/api/v1  NEXT_PUBLIC_SOCKET_PATH=/socket.io
MEDIA_DIR=./storage/media  (opcional; docker-compose define /data/media, volume media_data)
```

## 9. Segurança / Multitenancy (obrigatório)
- JWT payload: `{ sub: userId, orgId, role }`. RBAC via decorator `@Roles()` + guard.
- **Prisma Client Extension** com AsyncLocalStorage: toda query de modelos tenant recebe `where { orgId }` injetado automaticamente; criação injeta `orgId`. Bypass explícito só em código de webhook/system com `prismaSystem`.
- Credenciais de canal: AES-256-GCM (`APP_ENCRYPTION_KEY`), IV aleatório por registro, nunca logadas nem retornadas em API.
- Rate limit no gateway (`@nestjs/throttler`): auth 5/min, `POST /api/webchat/session` 10/min, webhooks e `GET /api/health` isentos, demais 120/min.
- Anti-framing (web/Next `headers()`): `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` em TODAS as rotas do web, EXCETO `/webchat/widget` (embutível por design — `frame-ancestors *` explícito).
- Senhas: argon2id. Headers: helmet. CORS: PUBLIC_URL apenas.
- Validação: class-validator em TODOS os DTOs, `whitelist: true, forbidNonWhitelisted: true`.

## 10. Convenções de código
- TS strict. ESLint + Prettier padrão de cada framework. Sem `any` gratuito.
- Tipos compartilhados (eventos socket, enums espelhados, DTOs de API) em `@sm/shared` — **web importa de lá**; **api NÃO importa @sm/shared** (evita fricção de build tsc do Nest): usa tipos do Prisma e replica os NOMES DE EVENTOS exatamente como definidos em `packages/shared/src/socket.ts`.
- Commits convencionais (`feat:`, `fix:`, `chore:`).

## 11. Mapeamento do banco (obrigatório — Python faz SQL direto nas tabelas)
Todos os models Prisma DEVEM usar `@@map` para tabelas **snake_case plural** e `@map` para
colunas **snake_case**: `organizations`, `users`, `channels`, `contacts`, `contact_identities`,
`pipeline_stages`, `conversations`, `messages`, `tags`, `conversation_tags`, `automations`,
`automation_runs`, `knowledge_sources`, `knowledge_chunks`, `refresh_tokens`, `audit_logs`,
`webhook_event_logs`. Ex.: `orgId` → `org_id`, `createdAt` → `created_at`.
`knowledge_chunks`: colunas `id, org_id, source_id, content, embedding vector(1536), created_at`
com índice HNSW `vector_cosine_ops`. O serviço de IA lê/escreve `knowledge_sources.status/chunk_count`
e `knowledge_chunks` diretamente via SQL usando exatamente esses nomes.
