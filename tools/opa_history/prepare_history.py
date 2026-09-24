"""Prepara exportacoes do OPA para avaliacao offline; nunca publica no RAG.

Uso: python prepare_history.py entrada.jsonl saida.jsonl --salt "segredo-local"
Aceita JSONL com campos livres. O resultado remove dados sensiveis e inclui apenas
um identificador pseudonimo estavel, texto sanitizado e metadados de avaliacao.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import re
from pathlib import Path
from typing import Any

PATTERNS = (
    (re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b"), "[EMAIL]"),
    (re.compile(r"(?<!\d)(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?9?\d{4}[-\s]?\d{4}(?!\d)"), "[TELEFONE]"),
    (re.compile(r"(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)"), "[CPF]"),
    (re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)"), "[NUMERO_SENSIVEL]"),
    (re.compile(r"(?i)\b(?:senha|token|secret|api[_ -]?key)\s*[:=]\s*\S+"), "[CREDENCIAL]"),
)


def redact(text: str) -> str:
    for pattern, replacement in PATTERNS:
        text = pattern.sub(replacement, text)
    return text.strip()


def pseudonym(value: str, salt: str) -> str:
    return hmac.new(salt.encode(), value.encode(), hashlib.sha256).hexdigest()[:20]


def prepare(record: dict[str, Any], salt: str) -> dict[str, Any]:
    raw_id = str(record.get("contact_id") or record.get("phone") or record.get("id") or "unknown")
    messages = record.get("messages", [])
    safe_messages = []
    for item in messages if isinstance(messages, list) else []:
        if not isinstance(item, dict):
            continue
        role = str(item.get("role", "unknown"))
        safe_messages.append({"role": role, "content": redact(str(item.get("content", "")))})
    return {
        "historical_only": True,
        "publish_to_rag": False,
        "contact_ref": pseudonym(raw_id, salt),
        "messages": safe_messages,
        "evaluation": {"quality": None, "approved": False, "review_notes": None},
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--salt", required=True)
    args = parser.parse_args()
    with args.input.open(encoding="utf-8") as source, args.output.open("w", encoding="utf-8") as target:
        for line in source:
            if line.strip():
                target.write(json.dumps(prepare(json.loads(line), args.salt), ensure_ascii=False) + "\n")


if __name__ == "__main__":
    main()
