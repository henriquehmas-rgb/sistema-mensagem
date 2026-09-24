"""Valida ou publica a primeira leva aprovada de artigos de Suporte no RAG.

O modo padrão é somente leitura. A escrita exige, simultaneamente, --publish e
--approved-by; isso impede que uma execução acidental transforme rascunhos em
conhecimento recuperável.
"""

from __future__ import annotations

import argparse
import json
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from src import db
from src.ingest import run_ingest
from src.schemas import IngestRequest


def load_manifest(directory: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    manifest_path = directory / "manifest.json"
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if payload.get("schemaVersion") != 1:
        raise RuntimeError("Manifesto de RAG incompatível")
    if payload.get("department") != "technical_support":
        raise RuntimeError("Esta ferramenta só publica artigos de Suporte")
    if payload.get("publishToRag") is not False:
        raise RuntimeError("O manifesto precisa começar bloqueado para publicação")

    articles = payload.get("articles")
    if not isinstance(articles, list) or not articles:
        raise RuntimeError("Manifesto sem artigos")
    seen_ids: set[str] = set()
    prepared: list[dict[str, Any]] = []
    for article in articles:
        if not isinstance(article, dict):
            raise RuntimeError("Artigo inválido no manifesto")
        article_id = article.get("id")
        filename = article.get("file")
        authority = article.get("authority")
        if not isinstance(article_id, str) or not article_id or article_id in seen_ids:
            raise RuntimeError("Identificador de artigo ausente ou duplicado")
        if not isinstance(filename, str) or Path(filename).name != filename:
            raise RuntimeError(f"Arquivo inválido para o artigo {article_id}")
        if not isinstance(authority, int) or not 0 <= authority <= 100:
            raise RuntimeError(f"Autoridade inválida para o artigo {article_id}")
        content = (directory / filename).read_text(encoding="utf-8").strip()
        if len(content) < 120 or not content.startswith("# "):
            raise RuntimeError(f"Conteúdo insuficiente para o artigo {article_id}")
        seen_ids.add(article_id)
        prepared.append({
            "id": article_id,
            "filename": filename,
            "authority": authority,
            "name": content.splitlines()[0].removeprefix("# ").strip(),
            "content": content,
        })
    return payload, prepared


def publish(directory: Path, org_slug: str, approved_by: str) -> None:
    manifest, articles = load_manifest(directory)
    rows = db.fetch_all("SELECT id FROM organizations WHERE slug = %s", (org_slug,))
    if len(rows) != 1:
        raise RuntimeError("Organização não encontrada ou ambígua")
    org_id = str(rows[0][0])
    valid_until = (datetime.now(UTC) + timedelta(days=180)).isoformat()

    for article in articles:
        meta = {
            "contentText": article["content"],
            "governance": "APPROVED",
            "authority": article["authority"],
            "department": "technical_support",
            "origin": manifest["origin"],
            "contentClass": "FACTUAL_SUPPORT_GUIDANCE",
            "approvedBy": approved_by,
            "approvedAt": datetime.now(UTC).isoformat(),
            "validUntil": valid_until,
            "automaticPublication": False,
        }
        db.execute(
            """
            INSERT INTO knowledge_sources
                (id, org_id, type, name, status, meta, chunk_count, created_at, updated_at)
            VALUES (%s, %s, 'TEXT', %s, 'PENDING', %s::jsonb, 0, now(), now())
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name,
                status = 'PENDING',
                meta = EXCLUDED.meta,
                updated_at = now()
            WHERE knowledge_sources.org_id = EXCLUDED.org_id
            """,
            (article["id"], org_id, article["name"], json.dumps(meta, ensure_ascii=False)),
        )
        run_ingest(IngestRequest(
            org_id=org_id,
            source_id=article["id"],
            type="TEXT",
            content_text=article["content"],
            meta=meta,
        ))
        print(f"READY {article['id']} {article['filename']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--directory",
        type=Path,
        default=Path("docs/rag-suporte"),
        help="Diretório com manifesto e artigos",
    )
    parser.add_argument("--org", default="seeg")
    parser.add_argument("--publish", action="store_true", help="Executa a ingestão")
    parser.add_argument("--approved-by", default="", help="Responsável que aprovou a leva")
    args = parser.parse_args()

    _, articles = load_manifest(args.directory)
    if not args.publish:
        print(f"VALID {len(articles)} artigos; nenhum conteúdo foi publicado")
        return
    if not args.approved_by.strip():
        raise SystemExit("--approved-by é obrigatório para publicar")
    publish(args.directory, args.org, args.approved_by.strip())


if __name__ == "__main__":
    main()
