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

## Deploy
- VPS `/docker/sistema-mensagem/` via git clone + `docker compose up -d --build`.
- Traefik global já existente (rede `traefik`), wildcard `*.srv1450678.hstgr.cloud`.
- Host: `chat.srv1450678.hstgr.cloud` — prioridade de rotas: `/api` e `/socket.io` → api; resto → web.
