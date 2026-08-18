"""Pipeline de ingestao: extracao (PDF/URL/TEXT/TABLE) → chunking → embeddings → pgvector.

Executado como background task apos o 202 da rota POST /ingest. Atualiza
``knowledge_sources.status/chunk_count`` e substitui ``knowledge_chunks``
diretamente via SQL (CONTRACTS §7 e §11). Nunca propaga excecao: qualquer erro
marca a fonte como FAILED com ``meta.error``.

Seguranca do fetch de ``content_url`` (anti-SSRF): o servico roda na rede
interna do docker (CONTRACTS §2), entao URLs controladas por tenants NUNCA
podem alcancar hosts internos. Apenas http/https, hostname resolvido e
validado contra IPs privados/loopback/link-local/metadata ANTES de cada
request (inclusive a cada redirect), redirects limitados e download com
corte rigido de tamanho.
"""

from __future__ import annotations

import io
import ipaddress
import json
import logging
import re
import socket
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader

from . import db
from .config import get_settings
from .embeddings import get_embedding_provider
from .schemas import IngestRequest

logger = logging.getLogger(__name__)

_HTTP_TIMEOUT = 60.0
_USER_AGENT = "SEEG-Omni-AI/1.0 (+ingest)"
_MAX_REDIRECTS = 5
_MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024  # 25 MB — evita OOM por PDF/URL gigante
_MAX_PDF_PAGES = 500
_REDIRECT_STATUS_CODES = frozenset({301, 302, 303, 307, 308})
_STRIP_TAGS = (
    "script",
    "style",
    "noscript",
    "nav",
    "header",
    "footer",
    "aside",
    "form",
    "iframe",
    "svg",
    "template",
)
_SEPARATOR = "\n\n"

_INSERT_CHUNK_SQL = """
    INSERT INTO knowledge_chunks (id, org_id, source_id, content, embedding, created_at)
    VALUES (%s, %s, %s, %s, %s::vector, now())
"""


class IngestError(RuntimeError):
    """Erro de ingestao com mensagem apresentavel em meta.error."""


def chunk_text(text: str, *, chunk_size: int = 3000, overlap: int = 400) -> list[str]:
    """Divide texto em chunks de ~``chunk_size`` chars respeitando paragrafos.

    Chunks consecutivos compartilham um sufixo/prefixo de ``overlap`` chars
    (continuidade semantica). Paragrafos maiores que ``chunk_size`` sao
    fatiados em janelas fixas. Tamanho maximo real de um chunk:
    ``chunk_size + overlap + len(separador)``.
    """
    if chunk_size <= 0:
        raise ValueError("chunk_size deve ser positivo")
    if overlap < 0 or overlap >= chunk_size:
        raise ValueError("overlap deve estar em [0, chunk_size)")

    normalized = re.sub(r"\r\n?", "\n", text or "").strip()
    if not normalized:
        return []

    paragraphs = [part.strip() for part in re.split(r"\n{2,}", normalized) if part.strip()]

    pieces: list[str] = []
    for paragraph in paragraphs:
        if len(paragraph) <= chunk_size:
            pieces.append(paragraph)
        else:
            for start in range(0, len(paragraph), chunk_size):
                pieces.append(paragraph[start : start + chunk_size])

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        if not current:
            current = piece
        elif len(current) + len(_SEPARATOR) + len(piece) <= chunk_size:
            current = f"{current}{_SEPARATOR}{piece}"
        else:
            chunks.append(current)
            tail = current[-overlap:] if overlap else ""
            current = f"{tail}{_SEPARATOR}{piece}" if tail else piece
    if current:
        chunks.append(current)
    return chunks


@dataclass(frozen=True)
class FetchedContent:
    """Corpo baixado com corte de tamanho + charset declarado pelo servidor."""

    content: bytes
    charset: str | None = None

    @property
    def text(self) -> str:
        try:
            return self.content.decode(self.charset or "utf-8", errors="replace")
        except LookupError:  # charset declarado invalido/desconhecido
            return self.content.decode("utf-8", errors="replace")


def _assert_public_address(ip: ipaddress.IPv4Address | ipaddress.IPv6Address, host: str) -> None:
    mapped = getattr(ip, "ipv4_mapped", None)
    if mapped is not None:  # ::ffff:10.0.0.1 → valida o IPv4 embutido
        ip = mapped
    if (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    ):
        raise IngestError(f"content_url aponta para endereco de rede interno/privado ({host})")


def _validate_public_http_url(url: str) -> None:
    """Barreira anti-SSRF: apenas http/https e apenas hosts que resolvem para IP publico.

    Sem isto, um ADMIN de qualquer org poderia ingerir respostas de servicos da
    rede interna (api, redis, postgres, 169.254.169.254) e le-las via /query.
    Chamada antes de CADA request, inclusive a cada redirect. Observacao: entre
    a validacao e a conexao do httpx ha re-resolucao de DNS (janela teorica de
    rebinding); o risco residual e aceito — mitigacao completa exigiria pinning
    do IP resolvido na conexao.
    """
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        raise IngestError("content_url deve usar http ou https")
    host = parts.hostname
    if not host:
        raise IngestError("content_url invalida: host ausente")
    port = parts.port or (443 if parts.scheme == "https" else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise IngestError(f"nao foi possivel resolver o host de content_url ({host})") from exc
    if not infos:
        raise IngestError(f"nao foi possivel resolver o host de content_url ({host})")
    for info in infos:
        address = str(info[4][0]).split("%", 1)[0]  # remove zone-id de IPv6 link-local
        _assert_public_address(ipaddress.ip_address(address), host)


def _read_capped(response: httpx.Response) -> FetchedContent:
    """Le o corpo em streaming com corte rigido de ``_MAX_DOWNLOAD_BYTES``."""
    limit_mb = _MAX_DOWNLOAD_BYTES // (1024 * 1024)
    declared = response.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > _MAX_DOWNLOAD_BYTES:
        raise IngestError(f"arquivo excede o limite de {limit_mb} MB")
    buffer = bytearray()
    for chunk in response.iter_bytes():
        buffer.extend(chunk)
        if len(buffer) > _MAX_DOWNLOAD_BYTES:
            raise IngestError(f"arquivo excede o limite de {limit_mb} MB")
    return FetchedContent(content=bytes(buffer), charset=response.charset_encoding)


def _fetch(url: str, *, transport: httpx.BaseTransport | None = None) -> FetchedContent:
    """GET com anti-SSRF por hop, redirects manuais limitados e corte de tamanho."""
    current = url
    with httpx.Client(
        timeout=_HTTP_TIMEOUT,
        follow_redirects=False,
        headers={"User-Agent": _USER_AGENT},
        transport=transport,
    ) as client:
        for _ in range(_MAX_REDIRECTS + 1):
            _validate_public_http_url(current)
            with client.stream("GET", current) as response:
                if response.status_code in _REDIRECT_STATUS_CODES:
                    location = response.headers.get("location")
                    if not location:
                        raise IngestError("redirect sem header Location")
                    current = urljoin(current, location)
                    continue
                response.raise_for_status()
                return _read_capped(response)
    raise IngestError(f"numero maximo de redirects excedido ({_MAX_REDIRECTS})")


def extract_pdf(data: bytes) -> str:
    reader = PdfReader(io.BytesIO(data))
    if len(reader.pages) > _MAX_PDF_PAGES:
        raise IngestError(f"PDF excede o limite de {_MAX_PDF_PAGES} paginas")
    pages = [(page.extract_text() or "").strip() for page in reader.pages]
    return _SEPARATOR.join(page for page in pages if page)


def extract_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")
    for tag in soup(_STRIP_TAGS):
        tag.decompose()
    lines = [line.strip() for line in soup.get_text(separator="\n").splitlines()]
    text = "\n".join(lines)
    return re.sub(r"\n{3,}", _SEPARATOR, text).strip()


def extract_content(payload: IngestRequest) -> str:
    """Extrai o texto bruto da fonte conforme o tipo (CONTRACTS §7)."""
    if payload.type in ("TEXT", "TABLE"):
        if not payload.content_text:
            raise IngestError("content_text ausente para fonte TEXT/TABLE")
        return payload.content_text
    if not payload.content_url:
        raise IngestError("content_url ausente para fonte PDF/URL")
    fetched = _fetch(payload.content_url)
    if payload.type == "PDF":
        return extract_pdf(fetched.content)
    return extract_html(fetched.text)


def _replace_chunks(org_id: str, source_id: str, chunks: list[str], vectors: list[list[float]]) -> None:
    """Transacao unica: lock por fonte → DELETE chunks antigos → INSERT novos → READY."""
    rows = [
        (db.new_cuid(), org_id, source_id, content, db.vector_literal(vector))
        for content, vector in zip(chunks, vectors, strict=True)
    ]
    with db.connection() as conn:
        with conn.transaction():
            # Serializa reprocessamentos do MESMO source (retry do BullMQ +
            # re-upload concorrentes): sem o lock, dois DELETE+INSERT simultaneos
            # nao enxergam os INSERTs nao commitados um do outro e duplicam
            # chunks. Liberado automaticamente no fim da transacao.
            conn.execute(
                "SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))",
                (source_id,),
            )
            conn.execute(
                "DELETE FROM knowledge_chunks WHERE org_id = %s AND source_id = %s",
                (org_id, source_id),
            )
            with conn.cursor() as cursor:
                cursor.executemany(_INSERT_CHUNK_SQL, rows)
            conn.execute(
                """
                UPDATE knowledge_sources
                SET status = 'READY', chunk_count = %s, updated_at = now()
                WHERE id = %s AND org_id = %s
                """,
                (len(rows), source_id, org_id),
            )


def _mark_failed(payload: IngestRequest, error: str) -> None:
    try:
        db.execute(
            """
            UPDATE knowledge_sources
            SET status = 'FAILED',
                meta = COALESCE(meta, '{}'::jsonb) || %s::jsonb,
                updated_at = now()
            WHERE id = %s AND org_id = %s
            """,
            (json.dumps({"error": error[:2000]}), payload.source_id, payload.org_id),
        )
    except Exception:  # noqa: BLE001 — best-effort; nunca propagar do background task
        logger.exception("falha ao marcar source %s como FAILED", payload.source_id)


def run_ingest(payload: IngestRequest) -> None:
    """Processa uma fonte de conhecimento (chamado via BackgroundTasks)."""
    try:
        claimed = db.execute(
            """
            UPDATE knowledge_sources
            SET status = 'PROCESSING', updated_at = now()
            WHERE id = %s AND org_id = %s
            """,
            (payload.source_id, payload.org_id),
        )
        if claimed == 0:
            # Fonte inexistente ou org_id divergente do dono real: abortar evita
            # pagar embeddings e inserir chunks orfaos em knowledge_chunks.
            logger.warning(
                "ingest ignorado: source=%s inexistente ou nao pertence a org=%s",
                payload.source_id,
                payload.org_id,
            )
            return

        text = extract_content(payload)
        settings = get_settings()
        chunks = chunk_text(text, chunk_size=settings.chunk_size, overlap=settings.chunk_overlap)
        if not chunks:
            raise IngestError("nenhum conteudo textual extraido da fonte")

        vectors = get_embedding_provider(settings).embed(chunks)
        _replace_chunks(payload.org_id, payload.source_id, chunks, vectors)
        logger.info(
            "ingest concluido: source=%s org=%s chunks=%d",
            payload.source_id,
            payload.org_id,
            len(chunks),
        )
    except Exception as exc:  # noqa: BLE001 — fail-safe: FAILED + meta.error
        logger.exception("ingest falhou: source=%s org=%s", payload.source_id, payload.org_id)
        _mark_failed(payload, str(exc))
