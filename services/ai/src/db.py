"""Acesso ao PostgreSQL (psycopg 3 + pool). Tabelas snake_case — CONTRACTS §11."""

from __future__ import annotations

import logging
import secrets
import string
import threading
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from typing import Any

import psycopg
from psycopg_pool import ConnectionPool

from .config import get_settings

logger = logging.getLogger(__name__)

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()

_CUID_ALPHABET = string.ascii_lowercase + string.digits


def new_cuid() -> str:
    """Gera um id cuid-like (25 chars, prefixo 'c'), compativel com ids do Prisma."""
    return "c" + "".join(secrets.choice(_CUID_ALPHABET) for _ in range(24))


def vector_literal(values: Sequence[float]) -> str:
    """Serializa um vetor no formato textual do pgvector: '[f1,f2,...]'."""
    return "[" + ",".join(str(float(value)) for value in values) + "]"


def get_pool() -> ConnectionPool:
    """Pool global lazy (min_size=0 — nenhuma conexao criada ate o primeiro uso)."""
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                _pool = ConnectionPool(
                    conninfo=get_settings().psycopg_dsn,
                    min_size=0,
                    max_size=5,
                    timeout=10.0,
                    open=True,
                    name="sm-ai",
                )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


@contextmanager
def connection() -> Iterator[psycopg.Connection[Any]]:
    """Conexao do pool; commit no sucesso, rollback em excecao (semantica do pool)."""
    pool = get_pool()
    with pool.connection() as conn:
        yield conn


def execute(sql: str, params: Sequence[Any] | Mapping[str, Any] = ()) -> int:
    """Executa um comando e retorna o rowcount."""
    with connection() as conn:
        cursor = conn.execute(sql, params)
        return cursor.rowcount


def fetch_all(sql: str, params: Sequence[Any] | Mapping[str, Any] = ()) -> list[tuple[Any, ...]]:
    with connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(sql, params)
            return cursor.fetchall()


def healthcheck() -> bool:
    """Conexao direta com timeout curto (nao usa o pool para falhar rapido)."""
    try:
        with psycopg.connect(get_settings().psycopg_dsn, connect_timeout=2) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:  # noqa: BLE001 — health nunca propaga erro
        return False
