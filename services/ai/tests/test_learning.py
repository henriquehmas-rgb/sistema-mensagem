def test_learning_candidate_is_sanitized_and_eligible(client, auth_headers) -> None:
    response = client.post(
        "/learning/candidate",
        headers=auth_headers,
        json={"department_key": "technical_support", "question": "Como reinicio o roteador?", "answer": "Desligue por trinta segundos e ligue novamente."},
    )
    assert response.status_code == 200
    assert response.json()["eligible"] is True
    assert "Resposta registrada" in response.json()["content"]
    assert response.json()["quality_score"] >= 0.9
    assert response.json()["auto_publish_eligible"] is True
    assert len(response.json()["fingerprint"]) == 64


def test_learning_rejects_sensitive_data(client, auth_headers) -> None:
    response = client.post(
        "/learning/candidate",
        headers=auth_headers,
        json={"question": "Meu CPF é 123.456.789-00", "answer": "Cadastro localizado e atualizado com sucesso."},
    )
    assert response.json()["eligible"] is False
    assert response.json()["rejection_reason"] == "dado_sensivel"


def test_learning_rejects_contact_data(client, auth_headers) -> None:
    response = client.post(
        "/learning/candidate",
        headers=auth_headers,
        json={"question": "Onde envio o comprovante?", "answer": "Envie para suporte@empresa.com.br por favor."},
    )
    assert response.json()["eligible"] is False


def test_learning_never_auto_publishes_sales_or_factual_content(client, auth_headers) -> None:
    response = client.post(
        "/learning/candidate",
        headers=auth_headers,
        json={
            "department_key": "sales",
            "question": "Tem cobertura no meu endereço?",
            "answer": "Acesse a consulta oficial e aguarde a confirmação da disponibilidade.",
        },
    )
    assert response.json()["eligible"] is True
    assert response.json()["auto_publish_eligible"] is False


def test_learning_rejects_content_outside_support_domain(client, auth_headers) -> None:
    response = client.post(
        "/learning/candidate",
        headers=auth_headers,
        json={
            "department_key": "technical_support",
            "question": "Posso incluir minha esposa como dependente?",
            "answer": "Vou enviar o formulário de inclusão de dependente.",
        },
    )
    assert response.json()["eligible"] is False
    assert response.json()["rejection_reason"] == "dominio_incompativel"


def test_learning_rejects_incoherent_support_candidate(client, auth_headers) -> None:
    response = client.post(
        "/learning/candidate",
        headers=auth_headers,
        json={
            "department_key": "technical_support",
            "question": "Qual é o horário de atendimento?",
            "answer": "A luz LOS vermelha indica ausência de sinal óptico.",
        },
    )
    assert response.json()["eligible"] is False
    assert response.json()["rejection_reason"] == "pergunta_resposta_incoerentes"
