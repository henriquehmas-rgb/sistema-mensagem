# ARQUITETURA — SEEG Omni (sistema-mensagem)

Plataforma omnichannel de mensagens + CRM conversacional multitenant.
Canais: WhatsApp Cloud API (Meta), Instagram Direct, Webchat embutível.

O OPA é sistema legado a ser substituído. Fica fora do runtime: somente exportações históricas, anonimizadas e revisadas podem alimentar aprendizagem ou conjuntos de avaliação.

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
3. Se `conversation.aiEnabled` e sem agente ativo: job `ai-reply` com debounce configurável agrupa mensagens fragmentadas; somente o gatilho inbound mais recente chama FastAPI `/reply` (RAG pgvector dinâmico + guardrails) → resposta vira Message OUTBOUND → job `message-outbound` → Graph API → status via webhook (`sent/delivered/read`) → `message:status`.
4. A resposta também classifica intenção e `route_key`; a API persiste a triagem e seleciona o departamento ativo correspondente (fallback para o padrão).
5. Se `handoff=true`: abre um GAP interno deduplicado para o setor, avisa o cliente de forma natural e mantém `aiEnabled=true`; após a orientação autorizada, a própria IA retoma a conversa. Um humano só assume o atendimento por ação explícita de contingência.
6. Ao resolver um caso atendido por humano: pergunta/resposta final é sanitizada e pontuada → baixa qualidade é descartada; conteúdo útil permanece pendente → qualidade e recorrência priorizam a revisão → somente aprovação explícita de ADMIN/SUPERVISOR permite ingestão no RAG.
7. Eventos de negócio disparam `automation-run` (motor de automações: condições → ações).

A memória individual do contato, o histórico recente da conversa e o repertório geral da organização são camadas separadas. O aprendizado supervisionado alimenta apenas o repertório geral após revisão, evitando memorizar PII, respostas equivocadas ou instruções maliciosas enviadas por clientes.

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
- **Upload de mídia outbound (agente/webchat)**: implementado (CONTRACTS §13) — `POST /uploads`
  (agente, JWT) e `POST /webchat/uploads` (visitante, visitorToken) reaproveitam a mesma raiz
  `MEDIA_DIR` do re-host inbound acima, em `MEDIA_DIR/{orgId}/uploads/`. Validação de mime
  aceita o Content-Type reportado pelo multer/navegador (mimetype do cliente) mais uma checagem
  de assinatura binária (magic bytes) só para os formatos com assinatura simples e inequívoca
  (imagens comuns + PDF) — áudio/vídeo/Office não têm essa camada extra de verificação (mimetype
  do cliente é aceito como está para esses).

## Deploy
- VPS `/docker/sistema-mensagem/` via git clone + `docker compose up -d --build`.
- Traefik global já existente (rede `traefik`), wildcard `*.srv1450678.hstgr.cloud`.
- Host: `chat.srv1450678.hstgr.cloud` — prioridade de rotas: `/api` e `/socket.io` → api; resto → web.

## Skills operacionais e hierarquia de decisão

O catálogo `OperationalSkill` descreve protocolos por setor, com gatilhos, dados e fontes necessários, passos, ações permitidas/proibidas, identidade, confiança mínima e condições de conclusão, revisão e encaminhamento humano.

O ciclo é explícito: `DRAFT → IN_REVIEW → APPROVED → ACTIVE`. Conteúdo novo sempre cria uma versão em `DRAFT`; ao ativar uma versão, a anterior da mesma chave passa a `REPLACED`. O catálogo não executa integrações sozinho: ele limita o orquestrador e as camadas determinísticas.

Hierarquia prevista: regras rígidas de segurança e disponibilidade; roteamento determinístico com detecção de conflito; classificador de IA apenas quando necessário; skill ativa e RAG autorizado; execução por conector somente quando permitida; GAP humano quando não houver base, confiança ou autorização suficiente.

Na resposta, a API envia somente as skills `ACTIVE` da organização. Após classificar a mensagem atual, o serviço de IA escolhe deterministicamente uma única skill pelo `routingKey` do setor e pelos `triggerConditions`. Somente essa skill entra no prompt. `allowedSources` funciona como allowlist do RAG e `minimumConfidence` pode elevar o piso necessário para resposta autônoma. A seleção é auditada por chave e versão. Um modelo auxiliar pode compactar conversas complexas, mas seu resumo não decide a skill, não autoriza ações e não substitui as fontes aprovadas; conversas simples seguem direto ao modelo principal.

A camada de ações possui um gate independente do modelo. Mesmo que a IA proponha uma ação, a simulação só chega às leituras de deduplicação do IXC depois de conferir skill ativa, validade, setor, allowlist/denylist, identidade e confiança. Esta etapa nunca escreve externamente e sempre sinaliza necessidade de aprovação humana.

Propostas autorizadas podem entrar numa fila interna versionada e auditada. A criação é idempotente, aprovação e rejeição são decisões finais para a proposta e há separação de responsabilidade: quem solicita não revisa. O estado `APPROVED` representa apenas autorização interna registrada; não existe, neste corte, executor de escrita no IXC ou no Olho de Deus.

A interface `/approvals`, visível somente para administradores e supervisores, apresenta resumo do caso, ação proposta, protocolo da conversa e versão da skill. A tela atualiza pendências periodicamente, separa aprovadas/rejeitadas e confirma toda decisão em diálogo explícito. Ela reforça visualmente que aprovação não executa a ação externa.

Antes de ligar propostas automáticas, o processor executa uma avaliação em modo sombra apenas para skills que permitem `request_ticket` ou `request_service_order`. A referência inequívoca do cliente IXC é preservada fora do prompt; o avaliador exige exatamente um contrato ativo, uma única ação, confiança suficiente, conversa sem esclarecimento/GAP e ausência de ticket/OS aberto. O resultado é somente auditado como elegível ou bloqueado, sem criar proposta.

Decisões comerciais sensíveis formam uma política rígida acima do RAG, das skills e do modelo. A conversa pode continuar pela IA e usar material comercial publicado, porém descontos, propostas personalizadas, preços especiais e mudanças de condição abrem consulta humana. Somente a orientação respondida nesse GAP específico permite que o texto revisado seja comunicado; não há autorização implícita ou execução automática.

A interface `/protocols` torna o catálogo administrável sem edição técnica. Administradores criam rascunhos e conduzem as transições; supervisores possuem leitura. O formulário organiza setor, responsável, confiança, identidade, gatilhos, dados, fontes, etapas, conclusão, GAP e ações propostas. A API impede ativação sem responsável, fonte explicitamente autorizada e ao menos uma etapa; ações comerciais também exigem condição de revisão humana registrada.
