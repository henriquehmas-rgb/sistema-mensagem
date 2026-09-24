"""Portão read-only de cobertura e segurança do RAG por setor.

Executar no contêiner da IA depois de ingestões ou antes de uma publicação:
``python -m src.rag_evaluation --org-id <id>``. O programa não grava no
banco, não chama IXC/ODG e não envia respostas a clientes.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass

from . import retrieval


@dataclass(frozen=True)
class EvaluationCase:
    sector: str
    question: str


CASES = (
    EvaluationCase("technical_support", "A luz LOS está vermelha e estou sem internet"),
    EvaluationCase("technical_support", "A internet está lenta nos dois celulares perto do roteador"),
    EvaluationCase("technical_support", "A luz LOS apagou, mas a conexão continua lenta"),
    EvaluationCase("technical_support", "Não tenho computador para testar a internet pelo cabo"),
    EvaluationCase("technical_support", "O Wi-Fi está ruim somente em um aparelho"),
    EvaluationCase("technical_support", "Já reiniciei o roteador e a internet continua oscilando"),
    EvaluationCase("technical_support", "Existe chamado ou ordem de serviço aberta para esta falha?"),
    EvaluationCase("technical_support", "Não consigo entrar no aplicativo porque as credenciais são inválidas"),
    EvaluationCase("technical_support", "Meu telefone fixo não faz nem recebe chamadas"),
    EvaluationCase("technical_support", "O técnico já veio e o mesmo problema voltou"),
    EvaluationCase("billing", "Como consigo a segunda via da fatura?"),
    EvaluationCase("billing", "Meu pagamento ainda não apareceu, como funciona a compensação?"),
    EvaluationCase("billing", "Qual é a orientação geral para parcelamento da fatura?"),
    EvaluationCase("billing", "Quero entender juros ou multa antes de negociar"),
    EvaluationCase("billing", "Meu pagamento não foi reconhecido"),
    EvaluationCase("billing", "Como funciona estorno ou reembolso?"),
    EvaluationCase("billing", "Quero cancelar e entender os efeitos na cobrança"),
    EvaluationCase("billing", "Quais informações da minha conta exigem validação de identidade?"),
    EvaluationCase("billing", "Posso consultar dados da minha fatura sem confirmar o cadastro?"),
    EvaluationCase("billing", "Como devo proceder quando existe uma condição financeira especial?"),
    EvaluationCase("sales", "Quais planos de internet estão disponíveis?"),
    EvaluationCase("sales", "Vocês têm cobertura no meu endereço?"),
    EvaluationCase("sales", "Preciso de internet residencial para streaming e trabalho remoto"),
    EvaluationCase("sales", "Quero internet comercial para minha empresa"),
    EvaluationCase("sales", "Que dados do endereço são necessários para verificar disponibilidade?"),
    EvaluationCase("sales", "Como funciona a proposta padrão depois da qualificação?"),
    EvaluationCase("sales", "Quero desconto ou uma condição especial"),
    EvaluationCase("sales", "Quero cancelar meu contrato"),
    EvaluationCase("sales", "Posso receber uma atualização depois?"),
    EvaluationCase("sales", "A cobertura pode ser prometida antes de verificar o endereço?"),
)


def evaluate(org_id: str, min_score: float = 0.35) -> list[dict[str, object]]:
    """Avalia recuperação factual sem expor conteúdo nem identificadores."""
    report: list[dict[str, object]] = []
    for case in CASES:
        chunks = retrieval.search(
            org_id,
            case.question,
            top_k=6,
            allowed_departments=("global", case.sector),
        )
        approved = [
            chunk
            for chunk in chunks
            if chunk.is_current
            and str(chunk.source_meta.get("governance") or "").upper() == "APPROVED"
            and str(chunk.source_meta.get("department") or "") in {"global", case.sector}
        ]
        best_score = max((chunk.score for chunk in approved), default=0.0)
        unique_sources = len({chunk.source_id for chunk in approved})
        passed = bool(approved) and best_score >= min_score and unique_sources >= 2
        report.append(
            {
                "sector": case.sector,
                "passed": passed,
                "approved_chunks": len(approved),
                "unique_sources": unique_sources,
                "best_score": round(best_score, 6),
            }
        )
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Avalia cobertura do RAG por setor")
    parser.add_argument("--org-id", required=True)
    parser.add_argument("--min-score", type=float, default=0.35)
    args = parser.parse_args()
    if not 0 <= args.min_score <= 1:
        parser.error("--min-score deve estar entre 0 e 1")
    report = evaluate(args.org_id, args.min_score)
    print(json.dumps({"cases": report, "passed": sum(item["passed"] for item in report), "total": len(report)}))
    return 0 if all(item["passed"] for item in report) else 1


if __name__ == "__main__":
    sys.exit(main())
