# syntax=docker/dockerfile:1.7
# =============================================================================
# web.Dockerfile — @sm/web (Next.js App Router, output: 'standalone')
# Build context: RAIZ do monorepo.
#   docker build -f infra/docker/web.Dockerfile .
# Requisito do apps/web/next.config: `output: 'standalone'` (já configurado).
# NEXT_PUBLIC_* são inlined no build — passe como build args (compose já passa).
# =============================================================================

# ----------------------------------------------------------------- base -----
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=1 \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable pnpm
WORKDIR /app

# ---------------------------------------------------------------- build -----
FROM base AS build
ARG NEXT_PUBLIC_API_URL=/api/v1
ARG NEXT_PUBLIC_SOCKET_PATH=/socket.io
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_SOCKET_PATH=${NEXT_PUBLIC_SOCKET_PATH} \
    NEXT_TELEMETRY_DISABLED=1

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --filter @sm/web...

COPY packages/shared packages/shared
COPY apps/web apps/web

# garante que a pasta exista mesmo se o app não tiver assets públicos
RUN mkdir -p apps/web/public \
 && pnpm --filter @sm/web run build

# --------------------------------------------------------------- runtime ----
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

# Em monorepo o output standalone preserva a estrutura: server.js fica em
# /app/apps/web/server.js e o node_modules mínimo na raiz do standalone.
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public

USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
