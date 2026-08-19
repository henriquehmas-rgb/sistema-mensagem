"""POST /memory/summarize: sem mensagens, fusao mock, dado sensivel, truncamento e fail-safe."""

from __future__ import annotations

from src.handoff import (
    SENSITIVE_DOCUMENT_DATA_REASON,
    SENSITIVE_PAYMENT_DATA_REASON,
    detect_handoff,
    detect_sensitive_data,
)

ORG_ID = "org_1"


def _summarize(client, auth_headers, existing_summary, messages):
    body = {
        "org_id": ORG_ID,
        "existing_summary": existing_summary,
        "messages": messages,
    }
    return client.post("/memory/summarize", json=body, headers=auth_headers)


# ------------------------------------------------------------ sem mensagens novas
def test_no_messages_returns_existing_summary_without_calling_llm(
    client, auth_headers, monkeypatch
) -> None:
    from src.routes import memory as memory_route

    def _boom():
        raise AssertionError("LLM nao deveria ser chamado quando nao ha mensagens novas")

    monkeypatch.setattr(memory_route, "get_chat_provider", _boom)

    existing = "Cliente prefere contato por WhatsApp à tarde."
    response = _summarize(client, auth_headers, existing, [])
    assert response.status_code == 200
    assert response.json()["summary"] == existing


def test_no_existing_summary_and_no_messages_returns_none(client, auth_headers) -> None:
    response = _summarize(client, auth_headers, None, [])
    assert response.status_code == 200
    assert response.json()["summary"] is None


# ------------------------------------------------------------------- fusao (mock)
def test_fusion_with_new_relevant_messages_is_deterministic_and_nonempty(
    client, auth_headers
) -> None:
    existing = "Cliente da região Sul, comprou o plano básico."
    messages = [{"role": "user", "content": "Prefiro ser contatado por e-mail, não por telefone."}]

    response_1 = _summarize(client, auth_headers, existing, messages)
    response_2 = _summarize(client, auth_headers, existing, messages)

    assert response_1.status_code == 200
    assert response_2.status_code == 200
    summary_1 = response_1.json()["summary"]
    summary_2 = response_2.json()["summary"]

    assert summary_1
    assert summary_1 == summary_2  # deterministico
    assert "região Sul" in summary_1  # preserva o resumo existente
    assert "e-mail" in summary_1  # incorpora o fato novo


def test_fusion_ignores_assistant_only_messages_and_keeps_existing_summary(
    client, auth_headers
) -> None:
    existing = "Cliente já comprou o plano premium."
    messages = [{"role": "assistant", "content": "Claro, já resolvo isso para você!"}]
    response = _summarize(client, auth_headers, existing, messages)
    assert response.status_code == 200
    assert response.json()["summary"] == existing


# ----------------------------------------------------------------- dado sensivel
def test_sensitive_payment_data_never_appears_in_summary(client, auth_headers) -> None:
    text = "Meu cartão é 4111 1111 1111 1111, pode cobrar"
    # sanity: mesma heuristica de handoff.py reconhece este texto como dado sensivel.
    assert detect_handoff(text) == SENSITIVE_PAYMENT_DATA_REASON

    response = _summarize(client, auth_headers, None, [{"role": "user", "content": text}])
    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary
    assert "4111" not in summary
    assert "1111" not in summary


def test_sensitive_document_data_never_appears_in_summary(client, auth_headers) -> None:
    text = "O número do meu cartão não está passando, cvv 123"
    assert detect_handoff(text) == SENSITIVE_PAYMENT_DATA_REASON

    response = _summarize(client, auth_headers, "Cliente novo.", [{"role": "user", "content": text}])
    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary
    assert "cvv 123" not in summary


def test_sensitive_cpf_never_appears_in_summary(client, auth_headers) -> None:
    """Regressão: CPF é um dado de documento, não bate no padrão de cartão (14-19
    dígitos) — precisa da regra dedicada em `handoff.py` para nunca ser persistido
    verbatim em `Contact.memorySummary` (CONTRACTS §15)."""
    text = "Meu CPF é 123.456.789-00, pode conferir meu cadastro?"
    assert detect_sensitive_data(text) == SENSITIVE_DOCUMENT_DATA_REASON

    response = _summarize(client, auth_headers, None, [{"role": "user", "content": text}])
    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary
    assert "123.456.789-00" not in summary
    assert "123456789" not in summary


def test_sensitive_unformatted_cpf_never_appears_in_summary(client, auth_headers) -> None:
    text = "meu cpf eh 12345678900 pode conferir"
    assert detect_sensitive_data(text) == SENSITIVE_DOCUMENT_DATA_REASON

    response = _summarize(client, auth_headers, "Cliente novo.", [{"role": "user", "content": text}])
    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary
    assert "12345678900" not in summary


def test_sensitive_data_scrubbed_even_when_another_rule_matches_first(
    client, auth_headers
) -> None:
    """Regressão: `detect_handoff` (usado para o MOTIVO de handoff em /reply) para
    na PRIMEIRA regra que casar — "cancelamento" vem antes do dado sensível na
    ordem de `_RULES`. O scrub de memória usa `detect_sensitive_data`
    (independente dessa prioridade) e não pode deixar o CPF vazar aqui."""
    text = "Quero cancelar, meu CPF é 123.456.789-00"
    assert detect_handoff(text) == "cancelamento"  # motivo de handoff não é o de dado sensível
    assert detect_sensitive_data(text) == SENSITIVE_DOCUMENT_DATA_REASON  # mas o scrub pega

    response = _summarize(client, auth_headers, None, [{"role": "user", "content": text}])
    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary
    assert "123.456.789-00" not in summary


# ------------------------------------------------------------------- truncamento
def test_result_is_truncated_to_max_1500_chars(client, auth_headers) -> None:
    long_existing = ("O cliente relatou uma preferência registrada anteriormente. " * 40).strip()
    assert len(long_existing) > 1500
    messages = [{"role": "user", "content": "Confirmo que continuo preferindo o mesmo horário."}]

    response = _summarize(client, auth_headers, long_existing, messages)
    assert response.status_code == 200
    summary = response.json()["summary"]
    assert summary is not None
    assert 0 < len(summary) <= 1500


# ------------------------------------------------------------------------ fail-safe
def test_llm_failure_returns_existing_summary_unchanged_never_propagates(
    client, auth_headers, monkeypatch
) -> None:
    from src.routes import memory as memory_route

    class _BoomProvider:
        name = "boom"

        def generate(self, messages, system):  # noqa: ANN001 — assinatura do ChatProvider
            raise RuntimeError("provider offline")

    monkeypatch.setattr(memory_route, "get_chat_provider", lambda: _BoomProvider())

    existing = "Resumo original que não pode ser perdido."
    messages = [{"role": "user", "content": "Alguma informação nova qualquer."}]
    response = _summarize(client, auth_headers, existing, messages)
    assert response.status_code == 200
    assert response.json()["summary"] == existing


def test_llm_timeout_returns_existing_summary_unchanged(client, auth_headers, monkeypatch) -> None:
    from src.routes import memory as memory_route

    def _boom_timeout(provider, messages, system, timeout):  # noqa: ANN001
        raise TimeoutError

    monkeypatch.setattr(memory_route, "generate_with_timeout", _boom_timeout)

    existing = "Resumo original que não pode ser perdido em timeout."
    messages = [{"role": "user", "content": "Alguma informação nova qualquer."}]
    response = _summarize(client, auth_headers, existing, messages)
    assert response.status_code == 200
    assert response.json()["summary"] == existing
