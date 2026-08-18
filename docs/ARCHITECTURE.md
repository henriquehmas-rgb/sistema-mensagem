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

## Limitações conhecidas (corte de escopo auditável)
- **Instagram Direct**: recebimento (webhook `object: instagram`, formato Messenger) e envio
  via Graph API ainda não implementados. Webhooks IG são registrados em `webhook_event_logs`
  com status `ignored`; envio OUTBOUND em canal INSTAGRAM se comporta como dev/demo (marca
  SENT sem entrega real). WhatsApp e Webchat estão completos (inbound + outbound + status).
- **Mídia inbound (WhatsApp)**: a URL de mídia da Meta expira em minutos e exige download
  autenticado + re-host. Mensagens de mídia armazenam `content.mediaId`/`mimeType` (não
  `mediaUrl`); a resolução/re-host de mídia é etapa futura.

## Deploy
- VPS `/docker/sistema-mensagem/` via git clone + `docker compose up -d --build`.
- Traefik global já existente (rede `traefik`), wildcard `*.srv1450678.hstgr.cloud`.
- Host: `chat.srv1450678.hstgr.cloud` — prioridade de rotas: `/api` e `/socket.io` → api; resto → web.
