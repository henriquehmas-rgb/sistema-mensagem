"""Resposta determinística para transições críticas entre setores."""

from dataclasses import dataclass


@dataclass(frozen=True)
class ResponseContract:
    key: str
    route_key: str
    next_step: str
    source: str
    text: str


CONTRACTS = {
    "support.los_to_slowness": ResponseContract(
        "support.los_to_slowness", "technical_support", "ASK_INTERNET_LIGHT",
        "policy:los-to-slowness-continuation",
        "Entendi. Como a luz LOS apagou, ela não está mais indicando falta de sinal óptico, mas a lentidão nos dois celulares continua sendo importante. A luz de internet está piscando ou fica apagada agora?",
    ),
    "support.regional_outage_confirmed": ResponseContract(
        "support.regional_outage_confirmed", "technical_support", "REGIONAL_INCIDENT_REGISTERED",
        "policy:regional-outage-confirmed",
        "Identificamos uma instabilidade regional confirmada e ela já foi registrada para tratativa da equipe de rede. Por enquanto, não vou pedir testes individuais nem criar uma ordem de serviço separada.",
    ),
    "billing.general_policy": ResponseContract(
        "billing.general_policy", "billing", "ASK_INVOICE_STATUS", "policy:billing-public-guidance",
        "Consigo te orientar sobre a regra geral do parcelamento sem alterar nada na sua conta. Para confirmar se existe alguma condição para a sua fatura, preciso consultar o cadastro. Ela ainda está em aberto ou já venceu?",
    ),
    "sales.start": ResponseContract("sales.start", "sales", "ASK_PRIMARY_USAGE", "policy:sales-qualification", "Para eu te orientar melhor, o que você mais usa na internet no dia a dia: trabalho remoto, streaming, jogos ou outra coisa?"),
    "sales.usage": ResponseContract("sales.usage", "sales", "ASK_PRIMARY_USAGE", "policy:sales-qualification", "Para eu te orientar melhor, o que você mais usa na internet no dia a dia: trabalho remoto, streaming, jogos ou outra coisa?"),
    "sales.address": ResponseContract("sales.address", "sales", "ASK_ADDRESS", "policy:sales-qualification", "Para verificar a disponibilidade agora, compartilhe sua localização pelo clipe. Se preferir, envie somente o CEP e o número do endereço — por exemplo: 12345-678, 100."),
    "sales.coverage_evidence": ResponseContract("sales.coverage_evidence", "sales", "REQUEST_COVERAGE_EVIDENCE", "policy:sales-coverage-evidence-boundary", "Obrigado. Com o endereço informado, a disponibilidade ainda precisa ser confirmada na base oficial antes de eu indicar os planos compatíveis. Não quero te prometer cobertura sem essa verificação."),
    "guard.identity_scope_technical": ResponseContract("guard.identity_scope_technical", "technical_support", "ASK_EQUIPMENT_LIGHTS", "policy:identity-scope-guard", "Entendi. Antes de consultar qualquer dado do contrato, ainda podemos avançar pela verificação técnica. Me diga apenas o que aparece nas luzes do equipamento agora."),
}


def response_contract(key: str) -> ResponseContract:
    return CONTRACTS[key]


def sales_coverage_evidence_reply(_auto_viability_url: str) -> str:
    """Mantém a confirmação no WhatsApp; nunca direciona a um formulário."""
    return response_contract("sales.coverage_evidence").text


def sales_coverage_evidence_consent_reply(_auto_viability_url: str) -> str:
    """Contingência segura quando a consulta direta não puder ser iniciada."""
    return (
        "A consulta oficial deveria acontecer por aqui. Ela não foi iniciada agora, "
        "então vou manter seu atendimento para revisão comercial sem te encaminhar a um formulário."
    )
