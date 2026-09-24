from src.output_guard import inspect_reply


def test_blocks_protected_financial_answer_without_identity() -> None:
    assert (
        inspect_reply("A fatura está em R$ 149,90.", identity_verified=False)
        == "resposta_protegida_sem_identidade_validada"
    )


def test_allows_protected_financial_answer_after_identity() -> None:
    assert inspect_reply("A fatura está em R$ 149,90.", identity_verified=True) is None


def test_blocks_secrets_even_after_identity() -> None:
    assert (
        inspect_reply("A senha: supersecreta", identity_verified=True)
        == "resposta_contem_dado_sensivel"
    )
    assert (
        inspect_reply("MAC 00:11:22:33:44:55", identity_verified=True)
        == "resposta_contem_dado_sensivel"
    )


def test_allows_generic_guidance_without_identity() -> None:
    assert (
        inspect_reply(
            "Posso ajudar com orientações gerais. Para consultar seus dados, preciso validar sua identidade.",
            identity_verified=False,
        )
        is None
    )


def test_blocks_commercial_commitment_without_human_review() -> None:
    assert (
        inspect_reply(
            "Consigo fazer por R$ 89,90 e aplicar desconto de 15%.",
            identity_verified=True,
        )
        == "condicao_comercial_sem_revisao_humana"
    )


def test_allows_commercial_commitment_after_specific_human_review() -> None:
    assert (
        inspect_reply(
            "A condição revisada permite desconto de 15%.",
            identity_verified=True,
            commercial_reviewed=True,
        )
        is None
    )


def test_allows_standard_published_price_without_custom_commitment() -> None:
    assert inspect_reply("O plano publicado custa R$ 99,90.", identity_verified=True) is None
