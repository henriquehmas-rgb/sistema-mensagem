#!/usr/bin/env bash
set -euo pipefail

archive="${1:-}"
app_dir="/docker/sistema-mensagem"
if [[ -z "$archive" || ! -f "$archive" ]]; then
  echo "Uso: sudo bash $0 /home/sm-colab/releases/omni-release-<data>.tar.gz" >&2
  exit 2
fi

cd "$app_dir"
mkdir -p .deploy-backups
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
compose=(/usr/bin/docker compose -f "$app_dir/infra/docker-compose.yml" --env-file "$app_dir/.env")

tar -czf ".deploy-backups/source-before-${stamp}.tar.gz" \
  --exclude=.git --exclude=.env --exclude=.deploy-backups \
  --exclude=node_modules --exclude=.next --exclude=.venv .

"${compose[@]}" exec -T postgres sh -c \
  'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' \
  | gzip > ".deploy-backups/postgres-before-${stamp}.sql.gz"

tar -xzf "$archive" -C "$app_dir"
"${compose[@]}" up -d --build

for _ in $(seq 1 40); do
  health="$(curl -fsS --max-time 5 https://chat.srv1450678.hstgr.cloud/api/health 2>/dev/null || true)"
  if [[ "$health" == *'"status":"ok"'* ]]; then
    break
  fi
  sleep 3
done

echo "$health" | grep -q '"status":"ok"'
"${compose[@]}" ps
"${compose[@]}" logs --since=5m api ai web 2>&1 \
  | grep -Ei 'fatal|panic|unhandled|migration.*failed' && exit 1 || true

echo "DEPLOY_OK"
echo "Backup de fonte: $app_dir/.deploy-backups/source-before-${stamp}.tar.gz"
echo "Backup PostgreSQL: $app_dir/.deploy-backups/postgres-before-${stamp}.sql.gz"
