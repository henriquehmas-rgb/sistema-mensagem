import json
from pathlib import Path

from src.triage import detect_intent


FIXTURE = Path(__file__).parent / "fixtures" / "opa_support_replay_v1.json"


def test_opa_replay_fixture_is_abstracted_and_never_publishable() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert payload["source"] == "OPA_ABSTRACTED_REPLAY"
    assert payload["historical_only"] is True
    assert payload["publish_to_rag"] is False
    assert payload["contains_raw_conversations"] is False


def test_recent_support_variations_route_safely() -> None:
    payload = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert len(payload["scenarios"]) == 35
    for scenario in payload["scenarios"]:
        result = detect_intent(scenario["message"])
        assert result.route_key == scenario["expected_route"], scenario["id"]
        assert result.conflict_detected is scenario["expected_conflict"], scenario["id"]
