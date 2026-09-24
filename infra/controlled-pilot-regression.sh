#!/usr/bin/env bash
set -euo pipefail

# Piloto fechado: valida a jornada sem iniciar containers de atendimento,
# chamar provedores, escrever no banco ou enviar mensagens. O perfil Compose
# `pilot` usa o estágio de build com dependências de teste e rede desativada.
APP_DIR="${1:-/docker/sistema-mensagem}"
compose=(sudo -n /usr/bin/docker compose \
  -f "${APP_DIR}/infra/docker-compose.yml" \
  --env-file "${APP_DIR}/.env" \
  --profile pilot)

test -f "${APP_DIR}/infra/docker/api.Dockerfile"

"${compose[@]}" build api-pilot

"${compose[@]}" run --rm --no-deps -T api-pilot \
  'pnpm --filter @sm/api exec vitest run \
    src/webchat/webchat.service.spec.ts \
    src/webhooks/webhooks.controller.spec.ts \
    src/webhooks/webhook-ingest.instagram.spec.ts \
    src/webhooks/webhook-ingest.whatsapp.spec.ts \
    src/contacts/contacts.service.spec.ts \
    src/queues/processors/message-outbound.processor.spec.ts \
    src/integrations/ixc/ixc-write-executor.spec.ts \
    src/conversations/conversations.service.spec.ts \
    src/queues/processors/memory-summarize.processor.spec.ts \
    src/follow-up/follow-up.policy.spec.ts \
    src/integrations/ixc/identity-attempt-limiter.spec.ts \
    src/queues/handoff-classification.spec.ts \
    src/queues/handoff-message.spec.ts \
    src/support-case-state/support-case-state.policy.spec.ts \
    src/regression/multisector-regression.spec.ts'
