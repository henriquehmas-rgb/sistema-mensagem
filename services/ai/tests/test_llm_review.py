from src.llm.review import approve_reply, needs_model_review
from src.triage import TriageResult


class Reviewer:
    def __init__(self, answer: str) -> None:
        self.answer = answer

    def generate(self, messages, system):  # noqa: ANN001
        return self.answer


def triage(route: str = "technical_support") -> TriageResult:
    return TriageResult(intent="support", route_key=route, confidence=0.9, evidence=())


def test_review_is_selective() -> None:
    assert not needs_model_review(triage(), 0.95, 0.8)
    assert needs_model_review(triage("billing"), 0.95, 0.8)
    assert needs_model_review(triage(), 0.85, 0.8)


def test_reviewer_requires_exact_approval() -> None:
    assert approve_reply(Reviewer("APPROVE"), question="q", proposed_reply="r", trusted_context="c", timeout=1)
    assert not approve_reply(Reviewer("APPROVE com ressalvas"), question="q", proposed_reply="r", trusted_context="c", timeout=1)
