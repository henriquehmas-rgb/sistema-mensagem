# syntax=docker/dockerfile:1.7
# =============================================================================
# api.Dockerfile — @sm/api (NestJS + Prisma + BullMQ)
# Build context: RAIZ do monorepo.
#   docker build -f infra/docker/api.Dockerfile .
# Requisitos do apps/api/package.json (conferidos por smoke checks no build):
#   - "prisma" e "@prisma/client" em "dependencies" (o runtime roda
#     `npx prisma migrate deploy`, então o CLI precisa existir em produção).
#   - "tsx" em "dependencies" (seed documentado no infra/README roda
#     `npx tsx prisma/seed.ts` dentro da imagem de produção).
# =============================================================================

# ----------------------------------------------------------------- base -----
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# build-essential + python3: compilação de binários nativos (argon2) caso não
# exista prebuild para a plataforma; openssl/ca-certificates: engines do Prisma.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential python3 openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable pnpm
WORKDIR /app

# ---------------------------------------------------------------- build -----
# Instala o workspace (dev deps incluídas), gera Prisma Client e compila o Nest.
FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @sm/api...

COPY packages/shared packages/shared
COPY apps/api apps/api

RUN pnpm --filter @sm/api exec prisma generate \
 && pnpm --filter @sm/api run build

# ------------------------------------------------------------- prod-deps ----
# Recria a MESMA árvore /app apenas com dependências de produção.
# (copiar a árvore inteira preserva os symlinks relativos do pnpm)
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @sm/api...

# schema + migrations + seed acompanham o runtime (migrate deploy / seed)
COPY apps/api/prisma apps/api/prisma
# Smoke checks: falham o BUILD (não o boot do container) se os CLIs exigidos
# pelo runtime não estiverem na árvore --prod (prisma/tsx em "dependencies").
RUN pnpm --filter @sm/api exec prisma -v \
 && pnpm --filter @sm/api exec tsx --version
# Gera o client dentro da árvore de produção (exige `prisma` em dependencies)
RUN pnpm --filter @sm/api exec prisma generate

# --------------------------------------------------------------- runtime ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=4000
# wget: healthcheck do docker-compose; openssl: Prisma query engine.
RUN apt-get update \
 && apt-get install -y --no-install-recommends wget openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=prod-deps --chown=node:node /app /app
COPY --from=build --chown=node:node /app/apps/api/dist /app/apps/api/dist

USER node
WORKDIR /app/apps/api
EXPOSE 4000

# Aplica migrations pendentes e sobe a API.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
