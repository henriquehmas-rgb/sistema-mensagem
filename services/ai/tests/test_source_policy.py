from src.retrieval import RetrievedChunk
from src.source_policy import conflicting_authoritative_facts


def chunk(text: str, authority: int = 90) -> RetrievedChunk:
    return RetrievedChunk(text, 0.9, "source", source_meta={"authority": authority})


def test_detects_numeric_conflict_in_authoritative_sources() -> None:
    assert conflicting_authoritative_facts("qual o prazo?", [chunk("Prazo: 3 dias"), chunk("Prazo: 5 dias")])


def test_ignores_non_quantitative_and_low_authority_conflicts() -> None:
    assert not conflicting_authoritative_facts("como funciona?", [chunk("3 dias"), chunk("5 dias")])
    assert not conflicting_authoritative_facts("qual o prazo?", [chunk("3 dias", 40), chunk("5 dias", 40)])
