#!/usr/bin/env sh
# Gate reutilizável para releases empacotadas que alteram somente a API.
# Executar na VPS como sm-colab; a única elevação permitida é o compose abaixo.
set -eu

app=/docker/sistema-mensagem
compose_file="$app/infra/docker-compose.yml"
env_file="$app/.env"

usage() {
  printf '%s\n' 'Uso: sh tools/release-api-guard.sh /caminho/release.tar.gz'
}

validate_env_contract() {
  root="$1"
  schema="$root/apps/api/src/config/env.validation.ts"
  sources="$root/apps/api/src"

  test -f "$schema" || {
    printf '%s\n' 'ERRO: contrato de ambiente da API não encontrado.' >&2
    return 1
  }

  declared="$(sed -nE 's/^[[:space:]]*([A-Z][A-Z0-9_]*):.*/\1/p' "$schema" | sort -u)"
  required="$(grep -RhoE "config\.get(OrThrow)?\([[:space:]]*['\"][A-Z][A-Z0-9_]*" "$sources" 2>/dev/null \
    | sed -E "s/.*['\"]([A-Z][A-Z0-9_]*).*/\1/" | sort -u || true)"

  missing=''
  for key in $required; do
    if ! printf '%s\n' "$declared" | grep -qx "$key"; then
      missing="${missing}${missing:+ }${key}"
    fi
  done

  if [ -n "$missing" ]; then
    printf '%s\n' "ERRO: código da API usa variáveis sem declaração no contrato: $missing" >&2
    return 1
  fi

  printf 'ENV_CONTRACT_OK keys=%s\n' "$(printf '%s\n' "$required" | sed '/^$/d' | wc -l | tr -d ' ')"
}

if [ "${1:-}" = '--check-root' ]; then
  test -n "${2:-}" || { usage >&2; exit 2; }
  validate_env_contract "$2"
  exit $?
fi

release="${1:-}"
test -n "$release" || { usage >&2; exit 2; }
test -f "$release" || { printf '%s\n' 'ERRO: pacote de release não encontrado.' >&2; exit 2; }
test -f "$compose_file" || { printf '%s\n' 'ERRO: compose da aplicação não encontrado.' >&2; exit 2; }
test -f "$env_file" || { printf '%s\n' 'ERRO: .env da aplicação não encontrado.' >&2; exit 2; }

# Recusa pacote que poderia escapar da raiz, expor segredos ou introduzir migração
# sem o procedimento específico de banco de dados.
entries="$(tar -tzf "$release")"
printf '%s\n' "$entries" | grep -Eq '(^/|(^|/)\.\.(/|$)|(^|/)\.env($|/)|(^|/)prisma/migrations/)' && {
  printf '%s\n' 'ERRO: pacote contém caminho não permitido, .env ou migração.' >&2
  exit 2
}

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$app/.deploy-backups"
backup="$backup_dir/api-release-before-$stamp.tar.gz"
backup_list="$(mktemp)"
created_list="$(mktemp)"
published=false
mkdir -p "$backup_dir"

while IFS= read -r entry; do
  [ -n "$entry" ] || continue
  case "$entry" in */) continue ;; esac
  if [ -e "$app/$entry" ]; then
    printf '%s\n' "$entry" >> "$backup_list"
  else
    printf '%s\n' "$entry" >> "$created_list"
  fi
done <<EOF
$entries
EOF

if [ -s "$backup_list" ]; then
  tar -czf "$backup" -C "$app" -T "$backup_list"
else
  tar -czf "$backup" --files-from /dev/null
fi

compose() {
  sudo -n /usr/bin/docker compose -f "$compose_file" --env-file "$env_file" "$@"
}

rollback() {
  if [ "$published" = false ]; then
    if [ -s "$backup_list" ]; then
      tar -xzf "$backup" -C "$app" || true
    fi
    while IFS= read -r entry; do
      [ -n "$entry" ] && rm -f "$app/$entry" || true
    done < "$created_list"
    compose build api || true
    compose up -d --no-deps --force-recreate api || true
  fi
  rm -f "$backup_list" "$created_list"
}
trap rollback EXIT

archive_hash="$(sha256sum "$release" | awk '{print $1}')"
tar -xzf "$release" -C "$app"
validate_env_contract "$app"
compose build api
compose up -d --no-deps --force-recreate api

healthy=false
for _ in $(seq 1 30); do
  status="$(compose ps --format json api 2>/dev/null || true)"
  if printf '%s' "$status" | grep -q '"Health":"healthy"'; then
    healthy=true
    break
  fi
  sleep 2
done

if [ "$healthy" != true ]; then
  printf '%s\n' 'ERRO: API não atingiu o healthcheck; release revertida.' >&2
  exit 1
fi

compose ps api
published=true
trap - EXIT
rm -f "$backup_list" "$created_list"
printf 'RELEASE_OK sha256=%s backup=%s\n' "$archive_hash" "$backup"
