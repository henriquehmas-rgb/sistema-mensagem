from __future__ import annotations

import os
from pathlib import Path

from src.llm.anthropic_provider import AnthropicChat
from src.llm.openai_provider import OpenAIChat
from src.embeddings import EMBEDDING_DIMENSION, OpenAIEmbeddings


def read_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def usage_line(label: str, provider) -> str:
    usage = provider.last_usage
    if usage is None:
        return f"{label}=OK usage=missing"
    return (
        f"{label}=OK model={usage.model} input={usage.input_tokens} "
        f"output={usage.output_tokens} cached={usage.cached_input_tokens} "
        f"cache_write={usage.cache_creation_input_tokens} reasoning={usage.reasoning_tokens}"
    )


def main() -> None:
    env_path = Path(os.environ.get("OMNI_ENV_PATH", "/docker/sistema-mensagem/.env"))
    env = read_env(env_path)

    sonnet = AnthropicChat(
        env["ANTHROPIC_API_KEY"],
        model="claude-sonnet-5",
        max_output_tokens=256,
        prompt_cache_enabled=True,
        prompt_cache_ttl="5m",
    )
    sonnet_text = sonnet.generate(
        [{"role": "user", "content": "Responda somente: OK"}],
        "Teste técnico interno. Não inclua explicações.",
    )
    if not sonnet_text:
        raise RuntimeError("Sonnet respondeu vazio")
    print(usage_line("SONNET", sonnet))

    luna = OpenAIChat(
        env["OPENAI_API_KEY"],
        model="gpt-5.6-luna",
        reasoning_effort="low",
        max_output_tokens=128,
    )
    luna_text = luna.generate(
        [{"role": "user", "content": "Responda somente: OK"}],
        "Teste técnico interno. Não inclua explicações.",
    )
    if not luna_text:
        raise RuntimeError("Luna respondeu vazio")
    print(usage_line("LUNA", luna))

    embeddings = OpenAIEmbeddings(
        env["OPENAI_API_KEY"],
        model="text-embedding-3-small",
    ).embed(["teste técnico interno do SEEG Omni"])
    if len(embeddings) != 1 or len(embeddings[0]) != EMBEDDING_DIMENSION:
        raise RuntimeError("Embedding retornou dimensão inesperada")
    print(f"EMBEDDING=OK model=text-embedding-3-small dimension={len(embeddings[0])}")


if __name__ == "__main__":
    main()
