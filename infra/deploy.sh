#!/usr/bin/env bash
# =============================================================================
# deploy.sh — deploy na VPS (rodar NA VPS, não na máquina local)
#   bash /docker/sistema-mensagem/infra/deploy.sh
# Pré-requisitos: repo clonado em /docker/sistema-mensagem, .env preenchido na
# raiz do repo, rede externa 'traefik' existente (Traefik global da VPS).
# =============================================================================
set -euo pipefail

APP_DIR="/docker/sistema-mensagem"
COMPOSE_FILE="infra/docker-compose.yml"
HEALTH_URL="https://chat.srv1450678.hstgr.cloud/api/health"

echo "==> [1/6] Entrando em ${APP_DIR}"
cd "${APP_DIR}"

if [ ! -f .env ]; then
  echo "ERRO: .env não encontrado em ${APP_DIR}. Copie .env.example e preencha os segredos." >&2
  exit 1
fi

echo "==> [2/6] Atualizando código (git pull)"
git pull --ff-only

echo "==> [3/6] Build das imagens (api, web, ai) — --pull atualiza as bases"
docker compose -f "${COMPOSE_FILE}" --env-file .env build --pull

echo "==> [4/6] Subindo containers (--remove-orphans limpa serviços renomeados)"
docker compose -f "${COMPOSE_FILE}" --env-file .env up -d --remove-orphans

echo "==> [5/6] Status dos serviços"
docker compose -f "${COMPOSE_FILE}" --env-file .env ps

echo "==> [6/6] Aguardando health da API em ${HEALTH_URL}"
for attempt in $(seq 1 24); do
  if curl -fsS --max-time 5 "${HEALTH_URL}" > /dev/null 2>&1; then
    echo "OK: API respondendo em ${HEALTH_URL}"
    exit 0
  fi
  echo "   tentativa ${attempt}/24 — aguardando 5s..."
  sleep 5
done

echo "ERRO: API não respondeu em ${HEALTH_URL} após ~2 minutos." >&2
echo "Diagnóstico: docker compose -f ${COMPOSE_FILE} --env-file .env logs --tail=100 api" >&2
exit 1
