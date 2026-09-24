#!/usr/bin/env sh
# Gate atômico para releases que alteram API e/ou Web.
# Executar na VPS como sm-colab; sudo é limitado apenas ao docker compose.
set -eu

app=/docker/sistema-mensagem
compose_file="$app/infra/docker-compose.yml"
env_file="$app/.env"

usage() { printf '%s\n' 'Uso: sh tools/release-app-guard.sh /caminho/release.tar.gz'; }

validate_env_contract() {
  root="$1" schema="$1/apps/api/src/config/env.validation.ts" sources="$1/apps/api/src"
  test -f "$schema" || { printf '%s\n' 'ERRO: contrato de ambiente da API não encontrado.' >&2; return 1; }
  declared="$(sed -nE 's/^[[:space:]]*([A-Z][A-Z0-9_]*):.*/\1/p' "$schema" | sort -u)"
  required="$(grep -RhoE "config\.get(OrThrow)?\([[:space:]]*['\"][A-Z][A-Z0-9_]*" "$sources" 2>/dev/null | sed -E "s/.*['\"]([A-Z][A-Z0-9_]*).*/\1/" | sort -u || true)"
  missing=''
  for key in $required; do
    if ! printf '%s\n' "$declared" | grep -qx "$key"; then missing="${missing}${missing:+ }${key}"; fi
  done
  test -z "$missing" || { printf '%s\n' "ERRO: código da API usa variáveis sem declaração no contrato: $missing" >&2; return 1; }
  printf 'ENV_CONTRACT_OK keys=%s\n' "$(printf '%s\n' "$required" | sed '/^$/d' | wc -l | tr -d ' ')"
}

if [ "${1:-}" = '--check-root' ]; then
  test -n "${2:-}" || { usage >&2; exit 2; }
  validate_env_contract "$2"; exit $?
fi

release="${1:-}"
test -n "$release" && test -f "$release" || { usage >&2; exit 2; }
test -f "$compose_file" && test -f "$env_file" || { printf '%s\n' 'ERRO: compose ou .env da aplicação não encontrado.' >&2; exit 2; }
entries="$(tar -tzf "$release")"
printf '%s\n' "$entries" | grep -Eq '(^/|(^|/)\.\.(/|$)|(^|/)\.env($|/)|(^|/)prisma/migrations/)' && {
  printf '%s\n' 'ERRO: pacote contém caminho não permitido, .env ou migração.' >&2; exit 2;
}

stamp="$(date -u +%Y%m%dT%H%M%SZ)" backup_dir="$app/.deploy-backups"
backup="$backup_dir/app-release-before-$stamp.tar.gz" backup_list="$(mktemp)" created_list="$(mktemp)" published=false
mkdir -p "$backup_dir"
while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  case "$entry" in */) continue ;; esac
  if [ -e "$app/$entry" ]; then printf '%s\n' "$entry" >> "$backup_list"; else printf '%s\n' "$entry" >> "$created_list"; fi
done <<EOF
$entries
EOF
if [ -s "$backup_list" ]; then tar -czf "$backup" -C "$app" -T "$backup_list"; else tar -czf "$backup" --files-from /dev/null; fi

compose() { sudo -n /usr/bin/docker compose -f "$compose_file" --env-file "$env_file" "$@"; }
wait_healthy() {
  service="$1"
  for _ in $(seq 1 30); do
    status="$(compose ps --format json "$service" 2>/dev/null || true)"
    printf '%s' "$status" | grep -q '"Health":"healthy"' && return 0
    sleep 2
  done
  return 1
}
rollback() {
  if [ "$published" = false ]; then
    [ -s "$backup_list" ] && tar -xzf "$backup" -C "$app" || true
    while IFS= read -r entry; do [ -n "$entry" ] && rm -f "$app/$entry" || true; done < "$created_list"
    compose build api web || true
    compose up -d --no-deps --force-recreate api web || true
  fi
  rm -f "$backup_list" "$created_list"
}
trap rollback EXIT

archive_hash="$(sha256sum "$release" | awk '{print $1}')"
tar -xzf "$release" -C "$app"
validate_env_contract "$app"
compose build api web
compose up -d --no-deps --force-recreate api
wait_healthy api || { printf '%s\n' 'ERRO: API não atingiu healthcheck; release revertida.' >&2; exit 1; }
compose up -d --no-deps --force-recreate web
wait_healthy web || { printf '%s\n' 'ERRO: Web não atingiu healthcheck; release revertida.' >&2; exit 1; }
compose ps api web
published=true
trap - EXIT
rm -f "$backup_list" "$created_list"
printf 'RELEASE_OK sha256=%s backup=%s\n' "$archive_hash" "$backup"
