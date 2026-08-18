# syntax=docker/dockerfile:1.7
# =============================================================================
# ai.Dockerfile — services/ai (FastAPI + RAG pgvector)
# Build context: RAIZ do monorepo.
#   docker build -f infra/docker/ai.Dockerfile .
# Serviço INTERNO: nunca exposto no Traefik nem em portas do host.
# =============================================================================

# ----------------------------------------------------------------- deps -----
# Compila/instala dependências em /install (mantém o runtime sem toolchain C).
FROM python:3.12-slim AS deps
ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*
COPY services/ai/requirements.txt /tmp/requirements.txt
RUN pip install --prefix=/install -r /tmp/requirements.txt

# --------------------------------------------------------------- runtime ----
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin ai
WORKDIR /app

COPY --from=deps /install /usr/local
COPY --chown=ai:ai services/ai/ ./

USER ai
# Smoke check: o entrypoint do CMD precisa importar já no BUILD da imagem
# (falha aqui, e não com crash-loop no runtime). Settings tem defaults para
# todas as envs, então o import não depende de .env presente.
RUN python -c "import src.app"

EXPOSE 8100
CMD ["uvicorn", "src.app:app", "--host", "0.0.0.0", "--port", "8100"]
