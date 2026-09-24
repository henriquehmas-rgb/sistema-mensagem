const IGNORED_MESSAGES = new Set([
  'oi', 'ola', 'olá', 'bom dia', 'boa tarde', 'boa noite', 'obrigado', 'obrigada',
]);

/** Fallback extrativo local: funciona mesmo quando o serviço de IA está indisponível. */
export function extractCaseSummary(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
): string | null {
  const useful: string[] = [];
  for (const message of [...messages].reverse()) {
    if (message.role !== 'user') continue;
    const clean = message.content.replace(/\s+/g, ' ').trim();
    const normalized = clean.toLocaleLowerCase('pt-BR').replace(/[!.,?]+$/g, '');
    if (!clean || IGNORED_MESSAGES.has(normalized)) continue;
    if (!useful.includes(clean)) useful.push(clean);
    if (useful.length === 3) break;
  }
  if (useful.length === 0) return null;
  const text = useful.reverse().join(' · ');
  if (text.length <= 280) return text;
  const shortened = text.slice(0, 277).replace(/\s+\S*$/, '');
  return `${shortened || text.slice(0, 277)}...`;
}
