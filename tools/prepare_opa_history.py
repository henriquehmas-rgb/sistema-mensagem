"""Converte uma exportação autorizada do OPA em arquivo anonimizado para revisão."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services" / "ai"))

from src.opa_history import prepare_export  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--salt-env", default="OPA_IMPORT_SALT")
    args = parser.parse_args()
    salt = os.environ.get(args.salt_env, "")
    if len(salt) < 16:
        raise SystemExit(f"Defina {args.salt_env} com ao menos 16 caracteres")
    payload = json.loads(args.input.read_text(encoding="utf-8"))
    prepared = prepare_export(payload, salt)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(prepared, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(prepared["counts"], ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
