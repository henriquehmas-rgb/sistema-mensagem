"""Ingestao: guarda anti-SSRF, limite de download, redirects e claim do source."""

from __future__ import annotations

import ipaddress
import socket

import httpx
import pytest
from pydantic import ValidationError

from src import ingest
from src.ingest import IngestError
from src.schemas import IngestRequest

_PUBLIC_IP = "93.184.216.34"


def _fake_getaddrinfo(host: str, port: int, *args: object, **kwargs: object):
    """Resolve IP literal para ele mesmo e qualquer hostname para um IP publico."""
    try:
        ipaddress.ip_address(host)
        address = host
    except ValueError:
        address = _PUBLIC_IP
    return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", (address, port))]


# ----------------------------------------------------- _validate_public_http_url
@pytest.mark.parametrize(
    "url",
    [
        "ftp://example.com/file.pdf",
        "file:///etc/passwd",
        "gopher://example.com/",
        "http:///sem-host",
    ],
)
def test_rejects_invalid_scheme_or_host(url: str) -> None:
    with pytest.raises(IngestError):
        ingest._validate_public_http_url(url)


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:4000/conversations",  # api interna
        "http://10.0.0.5/",  # rede privada classe A
        "http://172.16.0.1/",  # rede privada classe B (docker)
        "http://192.168.1.1/",  # rede privada classe C
        "http://169.254.169.254/latest/meta-data/",  # metadata de cloud
        "http://[::1]:8100/health",  # loopback IPv6
        "http://[::ffff:10.0.0.1]/",  # IPv4 privado mapeado em IPv6
        "http://0.0.0.0/",
    ],
)
def test_rejects_private_loopback_and_metadata_ips(url: str) -> None:
    with pytest.raises(IngestError, match="interno/privado"):
        ingest._validate_public_http_url(url)


def test_rejects_hostname_resolving_to_private_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    def resolve_private(host: str, port: int, *args: object, **kwargs: object):
        return [(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("10.0.0.7", port))]

    monkeypatch.setattr(ingest.socket, "getaddrinfo", resolve_private)
    with pytest.raises(IngestError, match="interno/privado"):
        ingest._validate_public_http_url("http://api.interna.example/segredo")


def test_accepts_public_host(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ingest.socket, "getaddrinfo", _fake_getaddrinfo)
    ingest._validate_public_http_url("https://example.com/doc.pdf")  # nao levanta


# ------------------------------------------------------------- IngestRequest DTO
def test_ingest_request_rejects_non_http_content_url() -> None:
    with pytest.raises(ValidationError):
        IngestRequest(
            org_id="org_1", source_id="src_1", type="URL", content_url="file:///etc/passwd"
        )


def test_ingest_request_accepts_https_content_url() -> None:
    payload = IngestRequest(
        org_id="org_1", source_id="src_1", type="URL", content_url="https://example.com/faq"
    )
    assert payload.content_url == "https://example.com/faq"


# ------------------------------------------------------------------ _read_capped
def test_download_aborts_when_content_length_exceeds_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ingest, "_MAX_DOWNLOAD_BYTES", 100)
    response = httpx.Response(200, content=b"")
    response.headers["content-length"] = "101"
    with pytest.raises(IngestError, match="limite"):
        ingest._read_capped(response)


def test_download_aborts_when_body_exceeds_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ingest, "_MAX_DOWNLOAD_BYTES", 10)
    response = httpx.Response(200, content=b"x" * 11)  # sem content-length confiavel
    with pytest.raises(IngestError, match="limite"):
        ingest._read_capped(response)


def test_download_within_limit_returns_content() -> None:
    response = httpx.Response(
        200, content=b"ola mundo", headers={"content-type": "text/html; charset=utf-8"}
    )
    fetched = ingest._read_capped(response)
    assert fetched.content == b"ola mundo"
    assert fetched.text == "ola mundo"


# ------------------------------------------------------------------------ _fetch
def test_fetch_blocks_redirect_to_private_ip(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ingest.socket, "getaddrinfo", _fake_getaddrinfo)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "public.example":
            return httpx.Response(302, headers={"location": "http://127.0.0.1:4000/internal"})
        return httpx.Response(200, text="conteudo interno que nao pode vazar")

    with pytest.raises(IngestError, match="interno/privado"):
        ingest._fetch("http://public.example/doc", transport=httpx.MockTransport(handler))


def test_fetch_follows_public_redirect(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ingest.socket, "getaddrinfo", _fake_getaddrinfo)

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/inicio":
            return httpx.Response(301, headers={"location": "https://public.example/final"})
        return httpx.Response(200, text="documento final")

    fetched = ingest._fetch(
        "https://public.example/inicio", transport=httpx.MockTransport(handler)
    )
    assert fetched.text == "documento final"


def test_fetch_limits_redirect_count(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ingest.socket, "getaddrinfo", _fake_getaddrinfo)
    counter = {"hops": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        counter["hops"] += 1
        return httpx.Response(302, headers={"location": f"https://public.example/{counter['hops']}"})

    with pytest.raises(IngestError, match="redirects"):
        ingest._fetch("https://public.example/0", transport=httpx.MockTransport(handler))
    assert counter["hops"] == ingest._MAX_REDIRECTS + 1


# -------------------------------------------------------------------- run_ingest
def test_run_ingest_aborts_when_source_missing_or_wrong_org(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(ingest.db, "execute", lambda sql, params=(): 0)
    extracted: list[object] = []
    monkeypatch.setattr(ingest, "extract_content", lambda payload: extracted.append(payload))

    payload = IngestRequest(org_id="org_1", source_id="src_x", type="TEXT", content_text="abc")
    ingest.run_ingest(payload)

    assert extracted == []  # nao faz fetch/embeddings/INSERT para source nao reivindicado
