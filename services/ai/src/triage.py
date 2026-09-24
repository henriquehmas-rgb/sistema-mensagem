"""Triagem determinística e conservadora para roteamento operacional."""

from __future__ import annotations

import re
from difflib import SequenceMatcher
from dataclasses import dataclass

from .textutils import normalize


@dataclass(frozen=True)
class TriageResult:
    intent: str
    route_key: str
    confidence: float
    secondary_intent: str | None = None
    alternative_route_key: str | None = None
    conflict_detected: bool = False
    evidence: tuple[str, ...] = ()


_RULES: tuple[tuple[str, str, re.Pattern[str]], ...] = (
    # Retenção é uma especialidade do setor oficial de Vendas, não um quarto setor.
    ("cancellation", "sales", re.compile(r"\bcancel|encerrar\s+(meu\s+)?contrato|nao\s+quero\s+mais")),
    # Termos de acordo, juros e parcelamento pertencem a Financeiro. Sem
    # esta regra explícita, "parcelamento" fica próximo de "cancelamento" na
    # heurística tolerante a erros e poderia seguir, incorretamente, para Vendas.
    ("billing", "billing", re.compile(r"\bfatura|\bboleto|segunda\s+via|pagamento|mensalidade|cobranca|vencimento|pix\b|debito|nota\s+fiscal|negoci|renegoci|parcel|acordo|juros|multa|reembolso|estorno|chargeback|contratos?\s+ativos?|renova[cç][aã]o\s+(?:do\s+)?contrato")),
    ("technical_support", "technical_support", re.compile(r"\bsem\s+intern(?:et)?\b|sem\s+(conexao|net\b)|internet\s+(caiu|cai|caindo|parou|nao\s+(?:esta\s+)?funcion\w*|sem\s+funcionar|nao\s+pega|lenta|ruim|oscil)|rede\s+nao\s+funcion\w*|net(?:\s+(?:vive|ta|esta))?\s+(caiu|cai|caindo|lenta|ruim|oscil)|nao\s+conecta|queda\s+de\s+conexao|instabil|rompimento|roteador|modem|onu\b|\blos\b|luz\s+(?:vermelha|piscando)|sinal|wifi|wi-fi|fibra|velocidade\s+.*(?:abaixo|baixa|ruim|lenta)|(?:todos|varios)\s+(?:os\s+)?aparelhos\s+.*offline|visita\s+tecnica|ordem\s+de\s+servico|\bos\s+(?:em\s+aberto|aberta|existente)|chamado\s+(?:aberto|existente)|tecnico\s+(?:nao\s+veio|ainda\s+nao\s+veio)|credenciais\s+invalidas|nao\s+consigo\s+entrar\s+no\s+(?:app|aplicativo)|telefone\s+.*(?:nao\s+(?:faz|recebe|liga)|sem\s+sinal)|desbloqueio")),
    # Linguagem observada em curadoria anonimizada: pessoas interessadas em
    # contratar para empresa frequentemente perguntam apenas por "internet
    # comercial", antes de responder qualquer menu binário. É uma intenção de
    # Vendas, não uma opção inválida nem um diagnóstico técnico.
    ("sales", "sales", re.compile(r"\bplano|contratar|assinar|(?:comprar|colocar|adquirir|instalar)\s+(?:uma\s+)?internet|adesao|preco|valor\s+do\s+plano|upgrade|mais\s+mega|cobertura|mudar\s+de\s+endereco|servico\s+adicional|proposta|orcamento|desconto|promocao|oferta|condicao\s+especial|internet\s+(?:comercial|residencial|para\s+(?:(?:minha|a)\s+)?(?:casa|residencia|empresa|escritorio))|plano\s+(?:comercial|para\s+empresa)|atend(?:e|em|emos).{0,40}endere[cç]o|endere[cç]o.{0,40}atend")),
)

_FUZZY_TERMS: tuple[tuple[str, str, str], ...] = (
    ("boleto", "billing", "billing"),
    ("fatura", "billing", "billing"),
    ("pagamento", "billing", "billing"),
    ("mensalidade", "billing", "billing"),
    ("cobranca", "billing", "billing"),
    ("parcelamento", "billing", "billing"),
    ("renegociacao", "billing", "billing"),
    ("reembolso", "billing", "billing"),
    ("estorno", "billing", "billing"),
    ("internet", "technical_support", "technical_support"),
    ("net", "technical_support", "technical_support"),
    ("roteador", "technical_support", "technical_support"),
    ("conexao", "technical_support", "technical_support"),
    ("lentidao", "technical_support", "technical_support"),
    ("instabilidade", "technical_support", "technical_support"),
    ("rompimento", "technical_support", "technical_support"),
    ("los", "technical_support", "technical_support"),
    ("credenciais", "technical_support", "technical_support"),
    ("aplicativo", "technical_support", "technical_support"),
    ("telefone", "technical_support", "technical_support"),
    ("desbloqueio", "technical_support", "technical_support"),
    ("cancelar", "cancellation", "sales"),
    ("cancelamento", "cancellation", "sales"),
    ("contratar", "sales", "sales"),
    ("assinar", "sales", "sales"),
    ("upgrade", "sales", "sales"),
    ("cobertura", "sales", "sales"),
    ("desconto", "sales", "sales"),
    ("proposta", "sales", "sales"),
    ("orcamento", "sales", "sales"),
    ("promocao", "sales", "sales"),
)

_TECHNICAL_PLAN_CONTEXT = re.compile(
    r"velocidade\s+.*(?:abaixo|baixa|ruim|lenta).*\bplano\b"
    r"|\bplano\b.*velocidade\s+.*(?:abaixo|baixa|ruim|lenta)"
)

# "Contrato ativo" pode ser uma consulta financeira, mas não deve vencer uma
# intenção comercial inequívoca de troca/upgrade de plano. Termos financeiros
# reais continuam prevalecendo em mensagens mistas.
_SALES_CONTRACT_CONTEXT = re.compile(
    r"\b(?:plano|mudar|alterar|trocar|upgrade|downgrade|mais\s+mega|oferta|proposta)\b"
)
_BILLING_FACTUAL_CONTEXT = re.compile(
    r"\b(?:fatura|boleto|pagamento|mensalidade|cobranca|vencimento|pix|debito|nota\s+fiscal|negoci|renegoci|parcel|acordo|juros|multa|reembolso|estorno|chargeback)\b"
)


def detect_intent(text: str) -> TriageResult:
    normalized = normalize(text)
    matches = [
        (intent, route_key)
        for intent, route_key, pattern in _RULES
        if pattern.search(normalized)
    ]
    if _SALES_CONTRACT_CONTEXT.search(normalized) and not _BILLING_FACTUAL_CONTEXT.search(normalized):
        matches = [match for match in matches if match[1] != "billing"]
    # "Velocidade abaixo do plano" descreve desempenho técnico, não intenção
    # comercial. A palavra "plano" isolada não deve criar um falso conflito.
    if _TECHNICAL_PLAN_CONTEXT.search(normalized):
        matches = [match for match in matches if match[1] != "sales"]
    if matches:
        primary_intent, primary_route = matches[0]
        secondary = next(
            ((intent, route) for intent, route in matches[1:] if route != primary_route),
            None,
        )
        return TriageResult(
            intent=primary_intent,
            route_key=primary_route,
            confidence=0.72 if secondary else 0.9,
            secondary_intent=secondary[0] if secondary else None,
            alternative_route_key=secondary[1] if secondary else None,
            conflict_detected=secondary is not None,
            evidence=tuple(intent for intent, _ in matches),
        )
    words = re.findall(r"[a-z0-9]+", normalized)
    fuzzy_matches: list[tuple[str, str, str]] = []
    for word in words:
        if len(word) < 4:
            continue
        for expected, intent, route_key in _FUZZY_TERMS:
            if SequenceMatcher(None, word, expected).ratio() >= 0.78:
                candidate = (expected, intent, route_key)
                if candidate not in fuzzy_matches:
                    fuzzy_matches.append(candidate)
    if fuzzy_matches:
        expected, primary_intent, primary_route = fuzzy_matches[0]
        secondary = next(
            ((intent, route) for _, intent, route in fuzzy_matches[1:] if route != primary_route),
            None,
        )
        return TriageResult(
            intent=primary_intent,
            route_key=primary_route,
            confidence=0.62 if secondary else 0.78,
            secondary_intent=secondary[0] if secondary else None,
            alternative_route_key=secondary[1] if secondary else None,
            conflict_detected=secondary is not None,
            evidence=tuple(item[0] for item in fuzzy_matches),
        )
    # Sem evidência suficiente, não inventamos um quarto setor. ``unrouted``
    # é um estado transitório: a resposta pede uma única clarificação e a
    # conversa só entra em Suporte, Financeiro ou Vendas quando houver sinal.
    return TriageResult(intent="general_support", route_key="unrouted", confidence=0.5)
