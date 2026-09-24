from src.rag_evaluation import CASES


def test_rag_gate_covers_ten_governed_cases_per_operational_sector() -> None:
    by_sector: dict[str, int] = {}
    for case in CASES:
        by_sector[case.sector] = by_sector.get(case.sector, 0) + 1
    assert by_sector == {"technical_support": 10, "billing": 10, "sales": 10}
