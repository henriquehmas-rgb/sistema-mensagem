/** Formatação de apresentação: nunca altera rota, fontes ou decisões operacionais. */
const MAX_BUBBLE_LENGTH = 300;
// 300 é limite de segurança; respostas comuns devem parecer uma conversa curta.
const TARGET_BUBBLE_LENGTH = 160;
const EMOJI = /\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*/gu;

function plainText(value: string, allowEmoji: boolean): string {
  let text = value
    .replace(/\r\n/g, '\n')
    .replace(/```[^\n]*\n?/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1: $2')
    .replace(/^[ \t]*#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]*>[ \t]*/gm, '')
    .replace(/^[ \t]*(?:[-*\u2022]|\d+[.)])[ \t]+/gm, '')
    .replace(/\*\*|__/g, '')
    .replace(/(^|[ \t])\*([^*\n]+)\*/gm, '$1$2')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!allowEmoji) return text.replace(EMOJI, '').replace(/[ \t]{2,}/g, ' ').trim();
  let seen = false;
  text = text.replace(EMOJI, (emoji) => {
    if (seen) return '';
    seen = true;
    return emoji;
  });
  return text;
}

function splitLongPiece(value: string): string[] {
  const result: string[] = [];
  let remaining = value.trim();
  while (remaining.length > TARGET_BUBBLE_LENGTH) {
    const head = remaining.slice(0, TARGET_BUBBLE_LENGTH + 1);
    const sentenceEnd = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
    const wordEnd = head.lastIndexOf(' ');
    // Preserva frases e palavras; texto contínuo (p.ex. URL) só é cortado no
    // limite máximo, nunca para atingir artificialmente o tamanho preferido.
    const nextWordEnd = remaining.indexOf(' ', TARGET_BUBBLE_LENGTH);
    const cut = sentenceEnd >= 70 ? sentenceEnd + 1
      : wordEnd >= 90 ? wordEnd
        : nextWordEnd > 0 && nextWordEnd <= MAX_BUBBLE_LENGTH ? nextWordEnd
          : Math.min(MAX_BUBBLE_LENGTH, remaining.length);
    result.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) result.push(remaining);
  return result;
}

/** Preserva o texto completo: respostas excepcionalmente longas podem exceder três bolhas. */
export function whatsappReplyParts(reply: string, customerUsedEmoji = false): string[] {
  const text = plainText(reply, customerUsedEmoji);
  if (!text) return [];
  const paragraphs = text.split(/\n{2,}/).map((part) => part.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);
  const parts: string[] = [];
  for (const paragraph of paragraphs) {
    for (const piece of splitLongPiece(paragraph)) {
      parts.push(piece);
    }
  }
  while (parts.length > 3) {
    const mergeAt = parts.findIndex((part, index) => index < parts.length - 1
      && `${part}\n\n${parts[index + 1]}`.length <= TARGET_BUBBLE_LENGTH);
    const fallbackMergeAt = mergeAt < 0 ? parts.findIndex((part, index) => index < parts.length - 1
      && `${part}\n\n${parts[index + 1]}`.length <= MAX_BUBBLE_LENGTH) : mergeAt;
    if (fallbackMergeAt < 0) break;
    parts.splice(fallbackMergeAt, 2, `${parts[fallbackMergeAt]}\n\n${parts[fallbackMergeAt + 1]}`);
  }
  return parts;
}

/** Variação reproduzível evita testes instáveis e mantém 35-50 ms por caractere. */
function fraction(seed: string): number {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) / 0xffffffff;
}

export function typingDelayMs(text: string, seed: string): number {
  const base = 35 + fraction(seed) * 15;
  const variation = 0.8 + fraction(`${seed}:variation`) * 0.4;
  return Math.max(1_500, Math.min(8_000, Math.round(text.length * base * variation)));
}

export function bubbleGapMs(seed: string): number {
  return Math.round(800 + fraction(seed) * 1_200);
}

export function hasEmoji(text: string): boolean {
  return /\p{Extended_Pictographic}/u.test(text);
}
