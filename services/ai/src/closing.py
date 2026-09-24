"""Encerramento natural e determinístico de conversas já em andamento."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Sequence

from .schemas import ChatMessageIn
from .textutils import normalize

_THANKS = re.compile(
    r"^(?:(?:entendi|certo|ta\s+bom|tá\s+bom|beleza|ok|okay)[,!. ]+)?"
    r"(?:muito\s+)?(?:obrigad[oa]|valeu|agradeco|agradeço)"
    r"(?:\s+(?:mesmo|viu|pela\s+(?:ajuda|orientacao|orientação)))?[!. ]*$"
)
_THANKS_WITH_RETURN = re.compile(
    r"^(?:(?:entendi|certo|ta\s+bom|tá\s+bom|beleza|ok|okay)[,!. ]+)?"
    r"(?:muito\s+)?(?:obrigad[oa]|valeu|agradeco|agradeço)"
    r"(?:\s+(?:mesmo|viu|pela\s+(?:ajuda|orientacao|orientação)))?"
    r"(?:[,!. ]+(?:quando|assim\s+que)\s+(?:eu\s+)?(?:estiver|tiver)\s+"
    r"(?:com\s+)?(?:os\s+)?dados\s*,?\s*(?:eu\s+)?(?:retorno|volto|chamo)"
    r"(?:\s+por\s+aqui)?)?[!. ]*$"
)
_RETURN_AFTER_THANKS = re.compile(
    r"\b(?:obrigad[oa]|valeu|agradeco|agradeço)\b.*\b(?:retorn(?:o|arei|ar)|volt(?:o|arei|ar)|cham(?:o|arei|ar))\b"
)
_DONE = re.compile(
    r"^(?:deu\s+certo|resolveu|resolvido|consegui|funcionou|era\s+isso|e\s+so\s+isso|"
    r"é\s+só\s+isso|so\s+isso|só\s+isso|nao\s+preciso\s+de\s+mais\s+nada|"
    r"não\s+preciso\s+de\s+mais\s+nada|nao,?\s*(?:obrigad[oa]|valeu))"
    r"(?:,?\s*(?:obrigad[oa]|valeu))?[!. ]*$"
)
_NORMALIZED = re.compile(
    r"^(?:(?:perfeito|entendi|beleza|otimo|ótimo)[,!. ]+)?"
    r"(?:(?:depois\s+de\s+alguns\s+minutos)[,!. ]+)?"
    r"(?:a\s+)?(?:conexao|conexão|internet|rede)\s+"
    r"(?:voltou\s+ao\s+normal|normalizou|estabilizou)"
    r"(?:\s+em\s+(?:todos\s+)?(?:os\s+)?aparelhos)?"
    r"(?:[,!. ]+(?:muito\s+)?(?:obrigad[oa]|valeu|agradeco|agradeço)"
    r"(?:\s+pela\s+(?:ajuda|orientacao|orientação))?)?[!. ]*$"
)
_NORMALIZED_SIMPLE = re.compile(
    r"^(?:(?:agora|por\s+enquanto)[,!. ]+)?"
    r"(?:(?:ta|tá|esta|está)\s+tudo\s+normal(?:\s+agora)?|"
    r"(?:a\s+)?(?:conexao|conexão|internet|rede)\s+(?:voltou(?:\s+a\s+funcionar)?|(?:esta|está)\s+normal))"
    r"(?:[,!. ]+(?:muito\s+)?(?:obrigad[oa]|valeu|agradeco|agradeço)"
    r"(?:\s+pela\s+(?:ajuda|orientacao|orientação))?)?[!. ]*$"
)
_GOODBYE = re.compile(r"^(?:tchau|ate\s+mais|até\s+mais|falou)(?:,?\s*(?:obrigad[oa]|valeu))?[!. ]*$")

_THANKS_VARIATIONS = (
    "Eu que agradeço. Se precisar, é só chamar.",
    "Obrigado pelo contato. Quando precisar, estou por aqui.",
    "Valeu pelo contato. Se precisar de algo mais, pode chamar.",
)
_RESOLVED_VARIATIONS = (
    "Que bom que deu certo. Se precisar, é só chamar.",
    "Fico feliz que tenha resolvido. Quando precisar, estou por aqui.",
    "Ótimo, então ficou resolvido. Se precisar de novo, pode chamar.",
)
_GENERAL_VARIATIONS = (
    "Obrigado pelo contato. Se precisar, estou por aqui.",
    "Valeu pelo contato. Quando precisar, pode chamar.",
    "Foi bom poder ajudar. Se precisar de mais alguma coisa, é só chamar.",
)


def closing_kind(messages: Sequence[ChatMessageIn]) -> str | None:
    """Classifica uma despedida somente quando já houve uma conversa real.

    Uma saudação ou agradecimento isolado como primeira mensagem não encerra nada.
    Exigimos ao menos uma resposta anterior do atendimento para evitar falso positivo.
    """
    if not messages or not any(message.role == "assistant" for message in messages[:-1]):
        return None
    last = messages[-1]
    if last.role != "user":
        return None
    text = normalize(last.content).strip()
    if not text or len(text) > 120 or "?" in text:
        return None
    if _DONE.fullmatch(text) or _NORMALIZED.fullmatch(text) or _NORMALIZED_SIMPLE.fullmatch(text):
        return "resolved"
    if (
        _THANKS.fullmatch(text)
        or _THANKS_WITH_RETURN.fullmatch(text)
        or _RETURN_AFTER_THANKS.search(text)
    ):
        return "thanks"
    if _GOODBYE.fullmatch(text):
        return "general"
    return None


def closing_message(kind: str, conversation_id: str) -> str:
    """Escolhe variação estável por conversa, sem aleatoriedade imprevisível."""
    variations = {
        "thanks": _THANKS_VARIATIONS,
        "resolved": _RESOLVED_VARIATIONS,
        "general": _GENERAL_VARIATIONS,
    }.get(kind, _GENERAL_VARIATIONS)
    digest = hashlib.sha256(f"{conversation_id}:closing:{kind}".encode()).digest()
    return variations[int.from_bytes(digest[:4], "big") % len(variations)]
