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
- **Conversation**: id, protocol, orgId, contactId, channelId, status `ConversationStatus{OPEN,PENDING,RESOLVED,SNOOZED}`, assigneeId?, stageId?, departmentId?, lastIntent?, triageConfidence?, triagedAt?, resolutionReasonId?, resolutionNote?, resolvedAt?, stagePosition Float, aiEnabled Boolean, unreadCount Int, lastMessageAt?, lastMessagePreview?
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
- **IxcIntegration**: id, orgId (unique), baseUrl, encryptedCredentials (usuário + token em AES-256-GCM), isEnabled, lastTestedAt?, lastTestSucceeded?. Nunca retornar credenciais.

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
- **Prontidão unificada (leitura, JWT)**: `GET /dashboard/readiness` retorna sempre em blocos separados `operational` (Suporte, Financeiro e Vendas) e `integration` (canais, alertas e topologia), sem percentual subjetivo. `GET/POST /dashboard/readiness/snapshots` (ADMIN|SUPERVISOR) lista ou congela somente esses agregados para comparação histórica; um snapshot não habilita entrega, escrita externa, automação ou roteamento e é auditado.
- **CRM Comercial Governado (interno, JWT)**: `GET/POST /sales/pipelines`, `POST /sales/pipelines/:pipelineId/stages`, `GET/POST /sales/opportunities`, `PATCH /sales/opportunities/:id`, `GET/POST /sales/opportunities/:id/tasks`, `PATCH /sales/tasks/:id` e `GET /sales/metrics`. Oportunidades pertencem ao contato e, quando aplicável, à conversa que as originou; o histórico continua centralizado no CRM. AGENT vê e opera somente o próprio departamento; ADMIN/SUPERVISOR atua na organização. Mudança para etapa final ou em espera exige motivo; retomada de etapa ativa limpa o motivo/fechamento anterior. A fundação não envia mensagens, não redistribui atendimentos, não aciona integrações e não cria automação externa.
- **IXC somente leitura**: `GET /integrations/ixc` (ADMIN), `PUT /integrations/ixc` (ADMIN; configura/rotaciona segredo), `POST /integrations/ixc/test` (ADMIN), `GET /integrations/ixc/customers/search?id=|cpfCnpj=|phone=` (autenticado, exatamente um filtro, 30/min), e consultas por cliente em `/contracts`, `/service-orders` e `/connections` (autenticado, 30/min). `/invoices` é restrita a ADMIN/SUPERVISOR (20/min) enquanto o fluxo de identidade não estiver homologado. O cliente envia exclusivamente `GET` com corpo JSON, Basic Auth e `ixcsoft: listar`; não existem rotas IXC de escrita nesta fase. Respostas são reduzidas por whitelist: conexão nunca expõe senha/IP/MAC/Wi-Fi e fatura nunca expõe boleto, linha digitável ou Pix.
- **Health público (sem JWT, isento de rate limit, FORA do prefixo `/v1`)**: `GET /api/health` → `{ status: 'ok'|'degraded', db: 'up'|'down', redis: 'up'|'down' }` — sempre HTTP 200; usado pelo healthcheck do Docker (infra/docker-compose.yml) e pelo deploy.sh
- **Webhooks públicos (sem JWT)**: `GET /api/webhooks/meta` (hub.challenge verify), `POST /api/webhooks/meta` (**validar `X-Hub-Signature-256` HMAC SHA-256 com META_APP_SECRET sobre o raw body**; 200 sempre; enfileirar)
- **Webchat público**: `POST /api/webchat/session {orgSlug}` → `{visitorToken, conversationId, orgName}` (**rate limit 10/min** — cria Contact+Conversation reais sem auth); `POST /api/webchat/messages`; `GET /api/webchat/messages?after=`; socket namespace `/webchat` com visitorToken (recebe `message:new {message}`, `message:status` e `typing` do agente; emite `typing {isTyping}` — relayado ao `/rt` como `typing {conversationId, contactId, isTyping}`). Mensagens entregues ao visitante (REST e relay do `/webchat`) SEMPRE com `errorMessage: null` — detalhe interno nunca sai da org (status FAILED basta). Widget embutível: `GET /webchat.js` (loader) + página `/webchat/widget?org=&parent=` (web). **Criação LAZY**: o loader só monta o iframe no primeiro clique na bolha e o widget só chama `POST /session` na PRIMEIRA mensagem do visitante — pageview/abertura nunca criam contato/conversa nem disparam automações. Canal WEBCHAT: `config.orgSlug` é server-autoritativo (a api grava o slug real da org; valor divergente → 400).
- **Mídia re-hospedada (pública, sem JWT, isenta de rate limit, FORA do `/v1`)**: `GET /api/media/:orgId/:arquivo` — serve a mídia inbound baixada da Meta (WhatsApp; env `MEDIA_DIR`, layout `{orgId}/{arquivo}`). Content-Type derivado da extensão (SVG nunca é servido), `Cache-Control: public, max-age=31536000, immutable`, `X-Content-Type-Options: nosniff`. Anti path-traversal: regex estrita nos dois segmentos (`orgId` = cuid; arquivo = 32 hex + extensão curta) + resolução absoluta com verificação de prefixo de `MEDIA_DIR` (violação → 400; inexistente → 404). **Segurança MVP**: URL não-adivinhável — nome de arquivo com 128 bits aleatórios (`{hex-128-bits}.{ext}`); o link é o segredo, sem auth adicional. Upload/anexos novos (webchat/agente) permanecem fora de escopo.

## 7. Serviço de IA (FastAPI) — interno, auth header `X-Service-Token: ${AI_SERVICE_TOKEN}`
- `POST /ingest {org_id, source_id, type, content_url?|content_text?, meta}` → processa async, chunking + embeddings + upsert pgvector, callback `PATCH api /internal/knowledge/:id/status` (ou atualiza direto no banco — decisão: **atualiza direto no Postgres**, mesma DATABASE_URL)
- `POST /query {org_id, query, top_k=6}` → `{chunks: [{content, score, source_id}]}` — SEMPRE filtra org_id
- `POST /reply {org_id, conversation_id, messages: [{role, content}], contact: {...}}` → `{reply, handoff, handoff_reason?, confidence, sources, intent, route_key, triage_confidence}`
  - Pipeline: busca semântica (pgvector) → rerank → prompt com guardrails (responder SÓ com base no contexto; se não souber, `handoff=true`) → LLM (env `AI_PROVIDER=openai|anthropic|google|mock`; **mock** = respostas determinísticas p/ dev sem chave)
  - Economia de contexto: a busca começa com até 3 chunks em perguntas curtas e confiáveis, sobe para 4 em perguntas médias e até 6 em consultas longas ou de baixa confiança, sempre respeitando `retrieval_top_k`.
  - Triagem antifalhas: classifica a necessidade atual sem prender a conversa ao setor anterior; múltiplas intenções reduzem a confiança e geram pergunta específica antes do roteamento. Ausência de evidência mantém `general` como fallback seguro.
  - Detecção de intenção de atendimento humano (pedido explícito, frustração, assunto sensível) → `handoff=true`
- `GET /health`
- `POST /learning/candidate {question, answer}` → `{eligible, content?, rejection_reason?}` — normaliza a solução humana e rejeita dados de pagamento, documentos, contatos e URLs antes de qualquer persistência.

Triagem determinística inicial: `technical_support→Suporte`, `billing→Financeiro`, `sales→Vendas` e `cancellation→Vendas` como especialidade de retenção; desconhecido usa Atendimento Geral apenas como fallback técnico. A classificação considera a necessidade atual, normaliza caixa/acentos e tolera erros de digitação nos termos centrais. A API resolve `route_key` contra `Department.routingKey` ativo e usa o fallback padrão quando necessário. Quando `handoff=true`, cria um GAP interno deduplicado, mantém `aiEnabled=true`, registra a mensagem SYSTEM, informa o cliente de forma natural e aguarda orientação. A orientação autorizada volta ao contexto e a IA retoma; transferência real só ocorre por ação humana explícita.

GAPs podem ser consultados e respondidos por ADMIN/SUPERVISOR em toda a organização. Um AGENT autenticado acessa somente GAPs vinculados ao seu próprio departamento ativo; dúvida sem setor ou de outro setor permanece invisível e não pode ser respondida por ele. A API aplica esse isolamento independentemente da interface.

Aprendizado governado: ao encerrar uma conversa, a última resposta humana e a pergunta anterior são sanitizadas, recebem nota de qualidade e impressão digital semântica simplificada, e são gravadas como `LearningCandidate(PENDING)`, no máximo uma por conversa. Conteúdo fraco ou sensível é descartado. Apenas orientação procedural de Suporte, com qualidade alta e sem dados pessoais, conta, cobertura, preço, prazo ou outro fato dinâmico pode ter uso `AUTO_REVIEW_REQUIRED`; Financeiro e Vendas nunca recebem esse uso provisório. Todo candidato, inclusive o provisório, passa por revisão humana semanal: aprovar torna a fonte definitiva e rejeitar remove a fonte provisória. `GET /knowledge/patterns` apresenta ocorrências em 7/30/90 dias e crescimento contra os 30 dias anteriores.

## 8. Variáveis de ambiente (`.env` na raiz de infra; `.env.example` versionado)
```
DATABASE_URL=postgresql://sm:sm@postgres:5432/sm
REDIS_URL=redis://redis:6379
JWT_SECRET= JWT_REFRESH_SECRET= APP_ENCRYPTION_KEY= (32 bytes hex)
AI_SERVICE_URL=http://ai:8100  AI_SERVICE_TOKEN=
AI_PROVIDER=mock  AI_PRIMARY_PROVIDER=  AI_AUXILIARY_PROVIDER=  AI_REVIEW_PROVIDER=  AI_FALLBACK_PROVIDER=
OPENAI_CHAT_MODEL=gpt-5.6-luna  ANTHROPIC_CHAT_MODEL=claude-sonnet-5
OPENAI_EMBEDDING_MODEL=text-embedding-3-small  OPENAI_REASONING_EFFORT=low
OPENAI_MAX_OUTPUT_TOKENS=512  ANTHROPIC_MAX_OUTPUT_TOKENS=1024
ANTHROPIC_PROMPT_CACHE_ENABLED=true  ANTHROPIC_PROMPT_CACHE_TTL=5m
AI_REPLY_DEBOUNCE_MS=3500  OPENAI_API_KEY=  ANTHROPIC_API_KEY=  GOOGLE_API_KEY=
META_APP_SECRET=  META_VERIFY_TOKEN=  META_GRAPH_VERSION=v21.0
PUBLIC_URL=https://chat.srv1450678.hstgr.cloud
IXC_ALLOWED_HOSTS=ixc.exemplo.com.br  (CSV de hosts exatos; obrigatório para configurar o IXC)
NEXT_PUBLIC_API_URL=/api/v1  NEXT_PUBLIC_SOCKET_PATH=/socket.io
MEDIA_DIR=./storage/media  (opcional; docker-compose define /data/media, volume media_data)
UPLOAD_DAILY_QUOTA_PER_ORG=300  (opcional; cota diária de uploads outbound por org, §13)
```

No desenho preparado para homologação, Anthropic/Sonnet é o gerador principal e OpenAI/Luna é auxiliar opcional. Regras determinísticas, IXC, RAG e skills são executados antes dos modelos. O Luna só compacta o estado quando a conversa apresenta múltiplos assuntos, baixa confiança, histórico longo ou mensagem extensa; sua saída é não autoritativa. Falha do auxiliar não bloqueia o Sonnet. Respostas simples não chamam o Luna.

## 9. Segurança / Multitenancy (obrigatório)
- JWT payload: `{ sub: userId, orgId, role }`. RBAC via decorator `@Roles()` + guard.
- **Prisma Client Extension** com AsyncLocalStorage: toda query de modelos tenant recebe `where { orgId }` injetado automaticamente; criação injeta `orgId`. Bypass explícito só em código de webhook/system com `prismaSystem`.
- Credenciais de canal: AES-256-GCM (`APP_ENCRYPTION_KEY`), IV aleatório por registro, nunca logadas nem retornadas em API.
- Credenciais IXC seguem a mesma cifra. A base URL exige HTTPS, caminho `/webservice/v1`, sem credenciais/query/fragmento, e hostname presente em `IXC_ALLOWED_HOSTS` (defesa SSRF). Respostas externas limitadas a 1MB e timeout de 8s; valores de CPF/telefone não entram no AuditLog.
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

## 12. Templates WhatsApp (Wave C)
- **Entidade MessageTemplate** (tabela `message_templates`, snake_case §11): id, orgId, channelId,
  name, language (código Meta, ex. `pt_BR`), category (`MARKETING`|`UTILITY`|`AUTHENTICATION`),
  status (`APPROVED`|`PENDING`|`REJECTED`|`PAUSED`|`DISABLED`), components Json (estrutura crua
  da Meta: header/body/footer/buttons), bodyParamsCount Int (nº de `{{n}}` no body, derivado no
  sync), metaTemplateId String?, lastSyncedAt DateTime?, createdAt/updatedAt.
  `unique(channelId, name, language)`.
- **Sync**: `POST /channels/:id/templates/sync` (ADMIN|SUPERVISOR) chama
  `GET /{wabaId}/message_templates?fields=name,language,status,category,components` na Graph API
  com o accessToken do canal e faz upsert por `(channelId, name, language)`; templates que
  sumiram da resposta da Meta viram `status=DISABLED` (não deletar — histórico de mensagens
  referencia o nome). `GET /channels/:id/templates?status=` lista os sincronizados.
- **Envio**: `MessageContent` do tipo TEMPLATE usa `{templateName, language, params?}` — o campo
  é **`language`** (NÃO `languageCode`; corrigir a leitura em `meta-graph.service.ts`, que hoje
  ignora o idioma real e sempre cai no fallback `pt_BR`). Parâmetros do body mapeados 1:1 na
  ordem de `params` (mesma lógica hoje existente, só a leitura do idioma muda).
- **UI**: aba "Templates" nas Configurações → Canais (canal WhatsApp): lista com badge de status
  colorido, botão "Sincronizar agora", preview do corpo com `{{n}}` destacado. No composer da
  Inbox, botão "Usar modelo" abre um seletor dos templates `APPROVED` do canal da conversa com
  inputs para cada `{{n}}` do body — obrigatório fora da janela de 24h (a API não bloqueia; a UI
  apenas avisa). O builder de Automações (ação `send_template`) passa a escolher o template de
  uma lista (não mais nome livre) e preencher os mesmos inputs de parâmetros.

## 13. Upload de mídia outbound (Wave C)
- **Motivo**: hoje anexos do agente e do visitante do webchat só aceitam URL (limitação
  documentada em ARCHITECTURE.md). Reaproveita a MESMA raiz de armazenamento do re-host inbound
  (`MediaService`/`MEDIA_DIR`), em subpasta separada: `MEDIA_DIR/{orgId}/uploads/{uuid128}.{ext}`,
  servida por rota própria (mesmas regras anti path-traversal do `MediaController` existente).
- **Agente (autenticado)**: `POST /api/v1/uploads` multipart/form-data, campo `file`, JWT Bearer,
  tenant-scoped (grava em `{orgId do usuário}/uploads/`). Limite 20MB. Whitelist de mime:
  image/*, audio/*, video/mp4, application/pdf e os tipos do WhatsApp Document. Resposta
  `{ mediaUrl, mimeType, filename, sizeBytes }` — `mediaUrl` no MESMO formato público
  (`/api/media/{orgId}/uploads/{arquivo}`) para o composer montar `content.mediaUrl` e enviar
  como mensagem normal (POST /conversations/:id/messages), sem mudar o contrato de mensagens.
- **Visitante do webchat (não autenticado)**: `POST /api/webchat/uploads`, header
  `Authorization: Bearer {visitorToken}` (mesmo esquema de `/api/webchat/messages`), mesmo
  limite/whitelist, resposta idêntica; o front do widget usa a URL retornada para enviar a
  mensagem via `POST /api/webchat/messages` com `content.mediaUrl`. Um `WebchatUploadGuard`
  valida o visitorToken ANTES do `FileInterceptor` rodar (Guards precedem Interceptors no
  pipeline do Nest) — token ausente/inválido nunca paga o custo de bufferizar até 20MB em
  memória; a rota também tem throttle próprio (20/min), mais restrito que o default (120/min).
- **`content.mediaUrl` é relativo — resolução obrigatória antes da Graph API**: a resposta de
  ambos os endpoints acima é sempre `/api/media/{orgId}/uploads/{arquivo}` (same-origin, pensado
  para o browser do composer/widget). `MetaGraphService` (WhatsApp/Instagram) resolve esse
  caminho para absoluto prefixando `PUBLIC_URL` (único host que serve web+api via Traefik, §2)
  antes de montar o payload da Graph API — sem isso a Meta recebe um link sem scheme/host e não
  consegue baixar a mídia. URLs já absolutas (aba "Por URL") passam intactas.
- **Cota diária por org**: `MediaService.storeUpload` conta uploads bem-sucedidos por org num
  contador Redis (`sm:upload-quota:{orgId}:{AAAA-MM-DD}`, TTL ~26h) contra `UPLOAD_DAILY_QUOTA_PER_ORG`
  (nova env var, default 300) — defesa contra esgotamento de disco do volume `media_data`
  (compartilhado entre TODAS as orgs). Fail-open em indisponibilidade do Redis.
- **Limpeza de uploads órfãos**: job BullMQ repetível `media-cleanup` (fila própria, agendado a
  cada 6h por `MediaCleanupScheduler`) remove arquivos de `MEDIA_DIR/{orgId}/uploads/` com mais
  de 48h (mtime) que nenhuma `Message.content.mediaUrl` da própria org referencia — cobre tanto
  o anexo estagiado no composer e descartado sem nunca ser enviado quanto uploads via
  `POST /webchat/uploads` sem nenhuma mensagem correspondente.
- **UI**: `attachment-popover.tsx` (composer da inbox) e o widget ganham uma aba "Enviar arquivo"
  (drag-and-drop + seletor) ao lado da aba "Por URL" já existente; barra de progresso simples
  durante o upload; erro de tamanho/tipo exibido inline.

## 14. Observabilidade (Wave C)
- **Logs estruturados**: JSON em produção (um logger único da api — `nestjs-pino` ou
  equivalente), com `orgId`/`userId`/`requestId` quando disponíveis via contexto de tenancy;
  texto legível em dev. Nenhuma credencial/PII em log (mascarar `accessToken`, `password`,
  `Authorization`).
- **Métricas Prometheus**: `GET /api/metrics` (VERSION_NEUTRAL, **NÃO público** — exige
  `X-Metrics-Token: ${METRICS_TOKEN}`, nova env var; `@SkipThrottle`), formato `prom-client`
  padrão (`prom-client` default metrics do Node) + custom: contagem/duração de requests HTTP por
  rota, profundidade e taxa de falha das 6 filas BullMQ (via `Queue.getJobCounts()`), latência do
  pipeline `/reply` da IA (histograma, populada pelo processor `ai-reply`).
- **Painel de filas**: `bull-board` montado em `/admin/queues` (VERSION_NEUTRAL), protegido por
  `@Roles('ADMIN')` (usa o mesmo JwtAuthGuard/RolesGuard globais — NÃO é `@Public`).
- **Rastreamento de erros (opcional)**: integração Sentry no-op quando `SENTRY_DSN` (nova env
  var) está vazio; captura de exceções não tratadas na api e no serviço de ia quando configurado.
- **Novas env vars** (`.env.example`): `METRICS_TOKEN=`, `SENTRY_DSN=` (ambas opcionais em dev,
  `METRICS_TOKEN` obrigatória em produção pelo mesmo `env.validation.ts`).
- **docker-compose**: nenhum serviço novo — tudo dentro do container `api`; `infra/README.md`
  documenta como consultar `/api/metrics` e `/admin/queues` a partir da VPS.

## 15. Memória de longo prazo por contato (Wave D)
- **Motivo**: a IA hoje só enxerga as últimas 12 mensagens da conversa atual (curto prazo,
  `ai-reply.processor.ts`, `HISTORY_SIZE`) e o conhecimento genérico da org via RAG — nada
  persiste entre conversas diferentes do MESMO contato. Adiciona um resumo cumulativo por
  contato, atualizado ao fim de cada conversa resolvida.
- **Campos novos em Contact** (não é entidade separada — 1:1 com o contato):
  `memorySummary String?` (texto livre, cap ~1500 chars), `memoryUpdatedAt DateTime?`.
  Mapeamento snake_case §11 na tabela `contacts`: `memory_summary`, `memory_updated_at`.
  Migration incremental nova (padrão de `000000000001_add_message_templates` — NÃO editar
  migrations existentes).
- **Gatilho**: em `ConversationsService.update` (apps/api/src/conversations/conversations.service.ts),
  quando `dto.status === ConversationStatus.RESOLVED` E o status ANTERIOR da conversa (leia
  ANTES do update) não era já `RESOLVED` — idempotência, não re-resumir ao reabrir/re-resolver
  sem mensagens novas — enfileira `memory-summarize` (fila BullMQ NOVA, prefixo `sm`,
  attempts:3, backoff exponencial, mesmo padrão das demais) com `{orgId, contactId, conversationId}`.
- **Processor `memory-summarize`** (api, novo, mesmo diretório de `queues/processors/`): busca
  as mensagens TEXT da conversa (mídia vira placeholder `"[enviou uma imagem/áudio/documento]"`
  conforme o tipo), o `memorySummary` atual do contato, chama o serviço de ia
  `POST /memory/summarize` (header `X-Service-Token`, mesmo padrão de `/reply` e `/ingest`),
  grava `Contact.memorySummary`/`memoryUpdatedAt` via `prismaSystem` (orgId manual do payload),
  emite `contact:updated` (evento JÁ EXISTENTE em `packages/shared/src/socket.ts` — mesmo
  formato `{contact}`, nenhuma mudança de contrato ali).
- **Serviço de IA — `POST /memory/summarize {org_id, existing_summary, messages}` → `{summary}`**:
  usa o MESMO provider/config de `/reply` (incluindo `mock` determinístico p/ dev sem chave);
  funde o resumo existente com os fatos novos da conversa. GUARDRAILS: extrair só fatos
  OBJETIVOS explicitamente ditos pelo contato (preferências, contexto recorrente, decisões,
  dados que ele mesmo informou) — NUNCA inferir/especular, NUNCA reter dado sensível de
  pagamento/documento (mesma heurística de detecção usada no handoff, `handoff.py` —
  `detect_sensitive_data`, que cobre cartão/CVV E CPF/RG/documento — serve de referência
  e é reaproveitada diretamente para blindar o conteúdo antes de chegar ao LLM); resultado
  cap ~1500 chars (`get_settings().memory_summary_max_chars`, fonte única compartilhada
  entre o truncamento e o texto da instrução ao LLM) — implementado como **truncamento
  seguro por corte em fronteira de frase/palavra** (`_truncate_summary`), SEM re-chamar o
  LLM para re-resumir (decisão de MVP; não é uma segunda chamada ao provedor); fail-safe:
  qualquer erro (LLM, timeout) retorna `{summary: existing_summary}` inalterado — o
  processor da api NUNCA apaga memória por falha, e só grava `memoryUpdatedAt` quando o
  `summary` devolvido difere do `memorySummary` atual do contato.
- **Injeção no `/reply` existente** (CONTRACTS §7, SEM mudar o formato do endpoint): o payload
  `contact:{...}` que a api já envia ganha o campo `memorySummary` (pode ser `null`). O system
  prompt do LLM (`services/ai/src/llm/prompts.py`) trata isso como "contexto sobre o contato"
  DISTINTO do RAG (conhecimento da empresa) e do histórico da conversa atual — rotulado
  explicitamente para o modelo não confundir a fonte nem tratar como instrução do usuário.
- **UI**: `crm-panel.tsx` (apps/web, inbox) ganha uma seção "Memória da IA" — somente leitura
  (texto do `memorySummary` + "atualizado há X" relativo, ou estado vazio "Nenhuma memória
  ainda"), com botão "Limpar memória" (reaproveita `PATCH /contacts/:id` já existente, campo
  novo `memorySummary: null`) e uma frase curta explicando o que é.
- **Rotas REST reaproveitadas** — SEM endpoint público novo na api: `ContactDto`
  (`packages/shared/src/models.ts`) ganha `memorySummary: string | null` e
  `memoryUpdatedAt: string | null`; `GET/PATCH /contacts/:id` (CONTRACTS §6) já cobre leitura e
  limpeza — `UpdateContactDto` ganha `memorySummary?: string | null` opcional (ADMIN/SUPERVISOR
  — checar/alinhar RBAC do PATCH existente).

## Skills operacionais versionadas

- `OperationalSkill` é sempre escopada por `org_id` e opcionalmente por departamento.
- Uma chave pode possuir várias versões, mas somente uma deve permanecer `ACTIVE`.
- Toda criação e nova versão nasce `DRAFT`; publicação requer revisão e aprovação explícitas.
- O histórico do OPA não pode ativar, aprovar ou alterar uma skill automaticamente.
- Conteúdo encontrado no RAG não concede autorização para executar uma ação; fontes e ações precisam estar permitidas pela skill ativa.
- Ativação e mudança de estado são restritas a `ADMIN` e auditadas.
- Rotas: `GET/POST /operational-skills`, `POST /operational-skills/:id/versions` e `PATCH /operational-skills/:id/status`.
- O `/reply` recebe apenas skills ativas, seleciona uma pelo setor e pelos gatilhos da mensagem atual e injeta somente o protocolo escolhido.
- `allowedSources` vazio permite as fontes normalmente recuperadas; preenchido passa a ser uma allowlist exata de `KnowledgeSource.id` (ou `*` para liberação explícita de todas).
- `minimumConfidence` nunca reduz o piso geral de segurança; somente pode torná-lo mais rigoroso.

### Barreira de ações operacionais

`POST /operational-actions/simulate` continua sem escrita externa e agora exige `skillId`. Antes de consultar o IXC, a API valida no próprio tenant: conversa e skill existentes, skill `ACTIVE` e não expirada, setor compatível, ação presente em `allowedActions` e ausente de `forbiddenActions`, identidade válida e confiança da triagem acima de `minimumConfidence`.

Se qualquer validação falhar, a resposta inclui `authorizedForSimulation=false` e os `blockers`, não consulta o IXC e mantém `externalReadPerformed=false` e `externalWritePerformed=false`. Quando passa, a leitura serve apenas para detectar ticket/OS aberto e gerar uma chave determinística de deduplicação; `requiresApproval` permanece sempre verdadeiro.

Propostas internas usam `OperationalActionRequest` e os estados `PENDING_REVIEW`, `APPROVED`, `REJECTED` e `CANCELLED`. `POST /operational-actions/proposals` repete o gate e só persiste quando a simulação está autorizada e sem duplicidade aberta; a chave `(org_id, deduplication_key)` torna retries idempotentes. `GET /operational-actions/proposals` lista a fila e `PATCH /operational-actions/proposals/:id/review` aprova ou rejeita. O solicitante não pode revisar a própria proposta. Aprovação não executa integração e qualquer execução futura deverá revalidar toda a política.

No frontend, `/approvals` é ocultada para `AGENT`; a API mantém `ADMIN|SUPERVISOR` como controle autoritativo. A tela não apresenta identificadores de cliente/contrato no cartão principal, desabilita revisão própria e exige confirmação antes de aprovar ou rejeitar.

### Avaliação em modo sombra

`IxcOperationalEvidence.customerRef` preserva internamente o cliente identificado sem incluí-lo nos blocos do prompt. Para skills com ação operacional suportada, `evaluateShadowAction` exige ação única e não proibida, ausência de handoff/esclarecimento, confiança mínima, evidência disponível, cliente inequívoco, exatamente um contrato ativo e ausência de duplicidade aberta. O processor grava `ai.operational-action.shadow.eligible|blocked` com ação e motivo, mas não persiste `OperationalActionRequest` nem realiza nova leitura/escrita externa.

### Condições comerciais sensíveis

Proposta personalizada, concessão de desconto, alteração de preço e mudança de condição comercial são sempre sujeitas a revisão humana, independentemente de skill, confiança ou provedor de IA. A IA pode informar preços e campanhas já publicados no RAG, mas pedidos de negociação específica geram GAP `commercial_approval_required`. A resposta ao cliente informa naturalmente que a condição será validada com o responsável. O guardrail de saída bloqueia compromisso comercial sem uma resposta humana associada especificamente a esse GAP; uma orientação de outro tipo não libera a condição.

### Administração de protocolos

### Follow-up controlado por conversa

- `FollowUpSequence` fica vinculada de forma única à conversa existente. Como a conversa já pertence a um contato e canal, o histórico permanece na mesma aba do CRM e a cadência não redistribui nem cria atendimento paralelo.
- Só nasce de consentimento explícito em resposta a um pedido inequívoco de retomada com atualização. A detecção guarda a sequência e a auditoria, não a frase de consentimento nem dados sensíveis.
- Abrange `technical_support`, `billing` e `sales`; o ciclo possui no máximo quatro etapas (1, 3, 7 e 14 dias). Qualquer nova mensagem do cliente pausa a sequência; opt-out a cancela. Conversa fechada pausa a etapa pendente. Assumir atendimento humano não pausa a cadência: o responsável de follow-up é configurado separadamente e pode ser o mesmo para os três setores.
- A fila de follow-up apenas muda uma etapa vencida para `READY_FOR_REVIEW`. Ela não cria mensagem, não usa `message-outbound`, não dispara template e não chama WhatsApp ou Instagram.
- Apenas uma mensagem humana da própria conversa, confirmada como `SENT`, pode registrar a etapa como efetivamente realizada e agendar a próxima. Não existe “contato realizado” manual.
- Rotas administrativas: `GET /follow-ups`, `PATCH /follow-ups/:id/review` e `GET /follow-ups/configuration` são restritas a `ADMIN|SUPERVISOR`; `PATCH /follow-ups/configuration` é exclusivo de `ADMIN` para definir o responsável padrão. Cada evento é auditado.
- Templates aprovados e canais reais continuam sendo pré-requisitos para um futuro piloto de envio; não foram ativados por esta cadência de revisão.

`/protocols` é visível a `ADMIN|SUPERVISOR`; somente `ADMIN` altera o ciclo. A ativação possui validação autoritativa na API e requer `owner`, `allowedSources` não vazio e `protocolSteps` não vazio. `*` em `allowedSources` significa liberação consciente de todas as fontes e deve ser usado somente após revisão. Se `allowedActions` contiver ação comercial sensível, `reviewConditions` também é obrigatório. A tela nunca ativa diretamente um rascunho: preserva `DRAFT → IN_REVIEW → APPROVED → ACTIVE`.
