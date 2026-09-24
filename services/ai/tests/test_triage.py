from src.triage import detect_intent


def test_routes_billing() -> None:
    assert detect_intent("Preciso da segunda via do boleto").route_key == "billing"


def test_routes_financial_policy_terms_without_confusing_parcelamento_with_cancellation() -> None:
    examples = (
        "Quais são as regras gerais de juros e parcelamento?",
        "Quero renegociar uma cobrança.",
        "Como funciona multa por atraso?",
        "Preciso pedir um estorno.",
        "Quais contratos ativos tenho?",
        "Quero entender a renovação do contrato.",
    )
    for example in examples:
        assert detect_intent(example).route_key == "billing", example


def test_routes_technical_support() -> None:
    assert detect_intent("Minha internet caiu e o modem está sem sinal").route_key == "technical_support"


def test_routes_internet_stopped_across_consecutive_messages_to_support() -> None:
    result = detect_intent("Oi\nEstou sem internet\nFaz muito tempo")
    assert result.route_key == "technical_support"
    assert result.confidence >= 0.9
    assert detect_intent("Minha internet parou de funcionar").route_key == "technical_support"


def test_routes_consecutive_sales_and_billing_messages_independently() -> None:
    assert detect_intent("Oi\nQuero contratar internet\nPara minha casa").route_key == "sales"
    assert detect_intent("Oi\nPreciso da segunda via da minha fatura\nVence hoje").route_key == "billing"


def test_natural_variants_match_the_operational_planner() -> None:
    for message, route in (
        ("Quero internet para minha casa", "sales"),
        ("Quero assinar internet", "sales"),
        ("Oi. Preciso comprar internet", "sales"),
        ("A internet não está funcionando", "technical_support"),
        ("Minha velocidade está abaixo do plano", "technical_support"),
        ("Preciso pagar a mensalidade", "billing"),
    ):
        result = detect_intent(message)
        assert result.route_key == route
        assert result.confidence >= 0.9


def test_routes_sales() -> None:
    assert detect_intent("Quero contratar um plano com mais megas").route_key == "sales"


def test_routes_residential_internet_request_to_sales_without_a_menu() -> None:
    result = detect_intent("Quero internet residencial para minha casa.")
    assert result.intent == "sales"
    assert result.route_key == "sales"


def test_routes_coverage_question_with_address_to_sales() -> None:
    assert detect_intent("Vocês atendem no meu endereço?").route_key == "sales"


def test_routes_plan_change_with_current_contract_to_sales() -> None:
    result = detect_intent("Quero mudar meu plano atual e verificar opções para o meu contrato")
    assert result.intent == "sales"
    assert result.route_key == "sales"


def test_keeps_billing_when_plan_change_mentions_an_invoice() -> None:
    result = detect_intent("Quero mudar meu plano, mas antes preciso entender a fatura em aberto")
    assert result.intent == "billing"
    assert result.route_key == "billing"


def test_routes_free_text_commercial_internet_to_sales_without_a_menu() -> None:
    result = detect_intent("Vocês têm internet comercial para minha empresa?")
    assert result.intent == "sales"
    assert result.route_key == "sales"


def test_routes_cancellation_with_priority() -> None:
    result = detect_intent("Quero cancelar meu plano por causa do boleto")
    assert result.intent == "cancellation"
    assert result.route_key == "sales"


def test_unknown_stays_unrouted_until_a_sector_is_identified() -> None:
    result = detect_intent("Olá, bom dia")
    assert result.route_key == "unrouted"
    assert result.confidence == 0.5


def test_tolerates_common_typing_errors() -> None:
    assert detect_intent("presiso do boelto").route_key == "billing"
    assert detect_intent("minha internete caiu").route_key == "technical_support"
    assert detect_intent("quero cancelr").route_key == "sales"


def test_detects_multiple_intents_without_guessing_silently() -> None:
    result = detect_intent("Paguei a fatura, mas continuo sem internet")
    assert result.intent == "billing"
    assert result.secondary_intent == "technical_support"
    assert result.alternative_route_key == "technical_support"
    assert result.conflict_detected is True
    assert result.confidence < 0.8


def test_current_message_can_be_classified_independently_from_old_subjects() -> None:
    result = detect_intent("Agora quero conhecer os planos disponíveis")
    assert result.route_key == "sales"
    assert result.conflict_detected is False
def test_support_understands_common_net_abbreviation() -> None:
    result = detect_intent("to sem net, consegue olhar pra mim?")
    assert result.intent == "technical_support"
    assert result.route_key == "technical_support"


def test_support_understands_homologated_language_variations() -> None:
    examples = (
        "to sem net desde cedo",
        "minha net ta ruim demais",
        "wifi tá horrível nos dois celulares",
        "a los ficou vermelha",
        "internete caiu dnv",
        "a conexão vive oscilando aqui",
    )
    for example in examples:
        result = detect_intent(example)
        assert result.route_key == "technical_support", example


def test_commercial_exception_routes_to_sales() -> None:
    result = detect_intent("Faz um desconto especial pra mim")
    assert result.intent == "sales"
    assert result.route_key == "sales"


def test_routes_recent_opa_support_variations_without_copying_customer_data() -> None:
    examples = (
        "A luz LOS está vermelha e piscando",
        "Tem uma ordem de serviço aberta para esse problema?",
        "O técnico ainda não veio",
        "Não consigo entrar no aplicativo, aparece credenciais inválidas",
        "Meu telefone comercial não faz nem recebe chamadas",
        "Minha velocidade está muito abaixo do plano",
        "Todos os aparelhos ficaram offline",
    )
    for example in examples:
        result = detect_intent(example)
        assert result.intent == "technical_support", example
        assert result.route_key == "technical_support", example


def test_speed_below_current_plan_does_not_create_false_sales_conflict() -> None:
    result = detect_intent("Minha velocidade está muito abaixo do plano")
    assert result.route_key == "technical_support"
    assert result.conflict_detected is False
