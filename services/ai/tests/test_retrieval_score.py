from src import retrieval
from src.llm.mock_provider import _focused_snippet
from src.retrieval import RetrievedChunk, _diverse_sources, _lexical_patterns, _relevance_score
from src.textutils import keyword_overlap


def test_literal_match_is_not_suppressed_by_mock_embedding() -> None:
    score = _relevance_score(
        "Qual e o horario de atendimento?",
        "Horario de atendimento: de segunda a sexta, das 8h as 18h.",
        cosine=-0.03,
    )

    assert score == 1.0


def test_semantic_score_supports_paraphrase_without_literal_overlap() -> None:
    assert _relevance_score("segunda via", "reemissao da fatura", cosine=0.8) == 0.6


def test_unrelated_low_score_remains_below_relevance_threshold() -> None:
    assert _relevance_score("prazo de entrega", "politica de trocas", cosine=0.2) < 0.45


def test_keyword_overlap_tolerates_portuguese_inflection() -> None:
    assert keyword_overlap("horario de atendimento", "A equipe atende das 8h as 18h") == 0.5


def test_lexical_candidate_window_preserves_relevant_word_roots() -> None:
    patterns = _lexical_patterns("Quais planos de internet vocês oferecem?")

    assert "%plano%" in patterns
    assert "%inter%" in patterns
    assert all(len(pattern) >= 7 for pattern in patterns)


def test_mock_reply_selects_only_the_sentence_related_to_the_question() -> None:
    block = (
        "A equipe atende de segunda a sexta, das 8h as 18h. "
        "O telefone e 3000-0000. O plano basico custa R$ 99."
    )

    snippet = _focused_snippet("Qual e o horario de atendimento?", block)

    assert snippet == "A equipe atende de segunda a sexta, das 8h as 18h."


def test_mock_mode_scans_and_ranks_lexically_instead_of_using_random_vector(
    monkeypatch,
) -> None:
    rows = [
        ("Politica de trocas: 30 dias.", "src_trocas", 0.0),
        ("Horario de atendimento: segunda a sexta, das 8h as 18h.", "src_horario", 0.0),
    ]
    captured_sql: list[str] = []

    def fake_fetch_all(sql: str, params: dict):
        captured_sql.append(sql)
        assert params["org_id"] == "org_1"
        assert params["embedding_provider"] == "mock:v1"
        return rows

    monkeypatch.setattr(retrieval.db, "fetch_all", fake_fetch_all)

    chunks = retrieval.search("org_1", "Qual e o horario de atendimento?", top_k=2)

    assert chunks[0].source_id == "src_horario"
    assert chunks[0].score == 1.0
    assert "ORDER BY kc.created_at DESC" in captured_sql[0]


def test_retrieval_prefers_distinct_sources_before_duplicate_chunks() -> None:
    chunks = [
        RetrievedChunk(content="a", score=0.95, source_id="long_protocol"),
        RetrievedChunk(content="b", score=0.94, source_id="long_protocol"),
        RetrievedChunk(content="c", score=0.90, source_id="specific_article"),
        RetrievedChunk(content="d", score=0.80, source_id="fallback"),
    ]

    result = _diverse_sources(chunks, top_k=3)

    assert [chunk.source_id for chunk in result] == [
        "long_protocol", "specific_article", "fallback",
    ]


def test_expired_catalog_snapshot_is_never_returned_as_current_knowledge(monkeypatch) -> None:
    """Catálogo vencido não pode sustentar preço, plano ou cobertura."""
    monkeypatch.setattr(retrieval, "get_settings", lambda: object())
    monkeypatch.setattr(retrieval, "get_embedding_provider", lambda _settings: retrieval.MockEmbeddings())
    monkeypatch.setattr(retrieval, "embedding_provider_fingerprint", lambda _settings: "mock")
    monkeypatch.setattr(
        retrieval.db,
        "fetch_all",
        lambda *_args, **_kwargs: [
            (
                "Plano publicado apenas no snapshot antigo.",
                "sales-expired-catalog",
                0.0,
                "TEXT",
                {
                    "department": "sales",
                    "governance": "APPROVED",
                    "validUntil": "2020-01-01T00:00:00Z",
                },
            ),
        ],
    )

    assert retrieval.search("org_1", "quais planos estão disponíveis", top_k=1) == []
