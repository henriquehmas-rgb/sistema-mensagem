# SEEG Omni — sistema-mensagem

Plataforma omnichannel de mensagens (WhatsApp Cloud API, Instagram Direct, Webchat) com CRM
conversacional em Kanban, IA com RAG e transbordo humano, automações e multitenancy.

## Stack
- **Web**: Next.js (App Router) + Tailwind + shadcn/ui + @dnd-kit
- **API**: NestJS + Prisma + PostgreSQL (pgvector) + BullMQ + Socket.io (Redis adapter)
- **IA**: FastAPI + LangChain + pgvector (busca semântica, guardrails, handoff)
- **Infra**: Docker Compose atrás de Traefik — `chat.srv1450678.hstgr.cloud`

## Documentação
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — visão geral e fluxos
- [docs/CONTRACTS.md](docs/CONTRACTS.md) — **fonte da verdade**: entidades, filas, eventos, rotas

## Dev local
```bash
pnpm install
docker compose -f infra/docker-compose.dev.yml up -d   # postgres + redis
pnpm dev
```

## Deploy (VPS)
```bash
cd /docker/sistema-mensagem
git pull
docker compose -f infra/docker-compose.yml up -d --build
```
