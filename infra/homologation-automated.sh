#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/docker/sistema-mensagem"
COMPOSE_FILE="${APP_DIR}/infra/docker-compose.yml"
ENV_FILE="${APP_DIR}/.env"
PUBLIC_BASE="https://chat.srv1450678.hstgr.cloud"
compose=(sudo -n /usr/bin/docker compose -f "${COMPOSE_FILE}" --env-file "${ENV_FILE}")

passed=0
failed=0

pass() { printf 'PASS | %s\n' "$1"; passed=$((passed + 1)); }
fail() { printf 'FAIL | %s\n' "$1"; failed=$((failed + 1)); }

echo "SEEG OMNI — HOMOLOGAÇÃO AUTOMATIZADA"
echo "Executado em $(date -u +%Y-%m-%dT%H:%M:%SZ)"

health="$(curl -fsS --max-time 10 "${PUBLIC_BASE}/api/health" || true)"
if [[ "${health}" == *'"status":"ok"'* && "${health}" == *'"db":"up"'* && "${health}" == *'"redis":"up"'* ]]; then
  pass "Health público, PostgreSQL e Redis"
else
  fail "Health público, PostgreSQL e Redis"
fi

web_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${PUBLIC_BASE}/")"
if [[ "${web_status}" == "200" || "${web_status}" == "307" ]]; then
  pass "Interface pública responde (${web_status})"
else
  fail "Interface pública responde (${web_status})"
fi

for endpoint in \
  '/api/v1/knowledge-gaps?status=PENDING' \
  '/api/v1/integrations/olho-de-deus/capabilities'; do
  status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "${PUBLIC_BASE}${endpoint}")"
  if [[ "${status}" == "401" ]]; then
    pass "Rota protegida sem sessão: ${endpoint}"
  else
    fail "Rota protegida sem sessão: ${endpoint} retornou ${status}"
  fi
done

action_status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  -X POST -H 'Content-Type: application/json' -d '{}' \
  "${PUBLIC_BASE}/api/v1/operational-actions/simulate")"
if [[ "${action_status}" == "401" ]]; then
  pass "Rota protegida sem sessão: /api/v1/operational-actions/simulate"
else
  fail "Rota protegida sem sessão: /api/v1/operational-actions/simulate retornou ${action_status}"
fi

migration="$(${compose[@]} exec -T api sh -c 'cd /app/apps/api && npx prisma migrate status' 2>&1 || true)"
if [[ "${migration}" == *'Database schema is up to date!'* ]]; then
  pass "Migrations do banco atualizadas"
else
  fail "Migrations do banco atualizadas"
fi

gap_table="$(${compose[@]} exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select to_regclass('"'"'public.knowledge_gaps'"'"');"' 2>&1 || true)"
if [[ "${gap_table}" == "knowledge_gaps" ]]; then
  pass "Persistência de GAP disponível"
else
  fail "Persistência de GAP disponível"
fi

# O avaliador não revela conteúdo, identificadores nem dados de contato; ele
# apenas confirma que cada setor recupera fonte aprovada, atual e compatível.
org_ids="$(${compose[@]} exec -T ai python -c \
  "from src import db; print('\\n'.join(row[0] for row in db.fetch_all('SELECT id FROM organizations ORDER BY created_at')))" 2>/dev/null || true)"
rag_failed=0
if [[ -z "${org_ids}" ]]; then
  fail "Avaliação factual do RAG: nenhuma organização encontrada"
else
  while IFS= read -r org_id; do
    [[ -z "${org_id}" ]] && continue
    if ! ${compose[@]} exec -T ai sh -lc \
      "cd /app && python -m src.rag_evaluation --org-id '${org_id}'" >/dev/null 2>&1; then
      rag_failed=1
      break
    fi
  done <<< "${org_ids}"
  if [[ "${rag_failed}" -eq 0 ]]; then
    pass "Avaliação factual do RAG por organização"
  else
    fail "Avaliação factual do RAG por organização"
  fi
fi

if ${compose[@]} exec -T ai python -m pytest -q >/tmp/seeg-ai-tests.log 2>&1; then
  pass "Suíte isolada da IA concluída"
else
  fail "Suíte isolada da IA"
  tail -n 20 /tmp/seeg-ai-tests.log
fi

unhealthy="$(${compose[@]} ps --format json | grep -Ev '"Health":"healthy"|"Service":"media-init"' || true)"
if [[ -z "${unhealthy}" ]]; then
  pass "Containers persistentes saudáveis"
else
  fail "Containers persistentes saudáveis"
fi

recent_errors="$(${compose[@]} logs --since=10m api ai web 2>&1 \
  | grep -Ei 'fatal|panic|uncaught|unhandled|migration failed' || true)"
if [[ -z "${recent_errors}" ]]; then
  pass "Sem erros críticos recentes nos serviços"
else
  fail "Sem erros críticos recentes nos serviços"
fi

echo "RESUMO | aprovados=${passed} falhos=${failed}"
[[ "${failed}" -eq 0 ]]
