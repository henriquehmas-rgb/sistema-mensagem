# ARQUITETURA — SEEG Omni (sistema-mensagem)

Plataforma omnichannel de mensagens + CRM conversacional multitenant.
Canais: WhatsApp Cloud API (Meta), Instagram Direct, Webchat embutível.

```
                        ┌─────────────────────────── VPS (Docker + Traefik) ───────────────────────────┐
 Meta (WhatsApp/IG) ──▶ │  /api/webhooks/meta ─▶ [api NestJS] ─▶ BullMQ(Redis) ─▶ processors           │
 Navegador ───────────▶ │  chat.srv1450678.hstgr.cloud ─▶ [web Next.js]                                │
                        │  /api, /socket.io ─▶ [api NestJS :4000] ◀─ Socket.io + Redis adapter         │
                        │  [ai FastAPI :8100] ◀── interno (X-Service-Token)                            │
                        │  [postgres pgvector :5432]   [redis :7 :6379]                                │
                        └──────────────────────────────────────────────────────────────────────────────┘
```

## Fluxo de mensagem entrante (WhatsApp)
1. Meta POST `/api/webhooks/meta` → valida assinatura SHA-256 → **200 imediato** → job `webhook-ingest`.
2. Processor: dedupe por wamid → resolve Channel/Contact/Conversation (cria se preciso) → grava Message → emite `message:new` via Socket.io/Redis.
3. Se `conversation.aiEnabled` e sem agente ativo: job `ai-reply` → FastAPI `/reply` (RAG pgvector + guardrails) → resposta vira Message OUTBOUND → job `message-outbound` → Graph API → status via webhook (`sent/delivered/read`) → `message:status`.
4. Se `handoff=true`: conversa move para stage de intervenção humana, `aiEnabled=false`, kanban atualiza em tempo real.
5. Eventos de negócio disparam `automation-run` (motor de automações: condições → ações).

**Instagram Direct** segue o mesmo pipeline com o payload Messenger (`object: instagram`,
`entry[].messaging[]`): Channel INSTAGRAM roteado por `externalId == recipient.id`
(ig business id), dedupe por `mid`, echoes (`message.is_echo`) e mensagens do próprio
business ignorados, nome/avatar do contato via Graph API `GET /{igsid}?fields=name,profile_pic`
(best-effort, fallback "Instagram User"). Mídia inbound guarda a URL do CDN da Meta em
`content.mediaUrl` (validade longa, sem re-host). Envio OUTBOUND via
`POST /{ig_business_id}/messages` (`{recipient:{id}, message:{text|attachment}}`) com o
`message_id` em `Message.externalId`; recibos `messaging[].read` marcam READ nas
OUTBOUND anteriores da conversa (+ `message:status`).

## Módulos do monorepo
| Caminho | Responsável | Conteúdo |
|---|---|---|
| `apps/api` | NestJS | auth/RBAC/tenancy, contatos, conversas, mensagens, canais (webhooks Meta + envio), realtime, automações, knowledge proxy |
| `apps/web` | Next.js | Inbox unificada, Kanban dnd-kit, CRM, configurações, webchat widget |
| `services/ai` | FastAPI | ingestão de conhecimento, busca vetorial, geração de resposta com guardrails, detecção de handoff |
| `packages/shared` | TS | tipos de eventos socket, enums, DTOs compartilhados |
| `infra` | docker | compose de produção (Traefik labels) e dev, Dockerfiles referenciados |
| `docs` | — | CONTRACTS.md (fonte da verdade), este arquivo, runbooks |

Detalhes de nomes/rotas/filas/eventos: **docs/CONTRACTS.md** (obrigatório para todo módulo).

## Mídia inbound (WhatsApp) — re-host
A URL de mídia da Meta expira em minutos e exige download autenticado; por isso a api
re-hospeda: o processor `webhook-ingest` tenta o re-host INLINE (MediaService:
`GET graph/{media_id}` → download com Bearer, limite 30MB, timeout curto) ANTES de criar a
Message → `content.mediaUrl` público (`/api/media/{orgId}/{arquivo}`, servido de `MEDIA_DIR`
— volume `media_data` no compose). Se o inline falhar, a Message nasce com `content.mediaId`
e um job delayed `media-fetch` (mesma fila, até 3 tentativas) completa o re-host e emite
`message:updated`. Não se aplica ao Instagram: as URLs do CDN IG têm validade longa e entram
direto em `content.mediaUrl`.

## Limitações conhecidas (corte de escopo auditável)
- **Upload de mídia (webchat/anexos do agente)**: nenhum endpoint de upload novo — o
  re-host acima cobre apenas mídia INBOUND do WhatsApp; anexos OUTBOUND continuam por URL.

## Deploy
- VPS `/docker/sistema-mensagem/` via git clone + `docker compose up -d --build`.
- Traefik global já existente (rede `traefik`), wildcard `*.srv1450678.hstgr.cloud`.
- Host: `chat.srv1450678.hstgr.cloud` — prioridade de rotas: `/api` e `/socket.io` → api; resto → web.
