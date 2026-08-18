# services/ai — SEEG Omni AI Service

Microserviço interno de IA/RAG (FastAPI, Python 3.12). Porta interna **8100**
(sem exposição pública — ver `docs/CONTRACTS.md` §2 e §7).

## Rotas

| Rota | Auth | Descrição |
|---|---|---|
| `GET /health` | pública | `{status, provider, db}` |
| `POST /ingest` | `X-Service-Token` | 202 imediato; extração + chunking + embeddings + upsert em `knowledge_chunks` (background) |
| `POST /query` | `X-Service-Token` | busca vetorial (pgvector, `org_id` obrigatório) + rerank híbrido |
| `POST /reply` | `X-Service-Token` | pipeline RAG com guardrails, heurística de handoff pt-BR e fail-safe (nunca propaga erro) |

## Desenvolvimento local (sem Docker)

```bash
cd services/ai
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Linux/macOS: .venv/bin/pip
cp .env.example .env                            # ajuste os valores
.venv/Scripts/uvicorn src.app:app --port 8100
```

`AI_PROVIDER=mock` (padrão) funciona de ponta a ponta sem nenhuma chave de API:
embeddings determinísticos (sha256 → PRNG, dim 1536) e chat mock que responde
com base no melhor chunk ou devolve `[HANDOFF]`.

## Testes

```bash
.venv/Scripts/python -m pytest -q
```

Sem rede e sem banco: provider mock + monkeypatch de DB onde necessário.
