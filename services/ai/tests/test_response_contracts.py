from src.response_contracts import CONTRACTS, response_contract


def test_critical_contracts_are_public_and_single_question() -> None:
    for key in ("support.los_to_slowness", "billing.general_policy", "guard.identity_scope_technical"):
        contract = response_contract(key)
        assert contract.source.startswith("policy:")
        assert "\n" not in contract.text
        # Uma instrução direta também é válida; o que não pode ocorrer é a
        # resposta introduzir perguntas paralelas para o cliente.
        assert contract.text.count("?") <= 1


def test_sales_contracts_follow_the_same_qualification_order() -> None:
    assert [CONTRACTS[key].next_step for key in ("sales.start", "sales.usage", "sales.address", "sales.coverage_evidence")] == [
        "ASK_PRIMARY_USAGE", "ASK_PRIMARY_USAGE", "ASK_ADDRESS", "REQUEST_COVERAGE_EVIDENCE"
    ]
