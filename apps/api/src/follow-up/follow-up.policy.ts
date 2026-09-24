const DAY = 24 * 60 * 60 * 1000;

/** Quatro abordagens no máximo; cada uma depende de nova revisão humana. */
export const FOLLOW_UP_DELAYS_MS = [DAY, 3 * DAY, 7 * DAY, 14 * DAY] as const;
export const FOLLOW_UP_MAX_STEPS = FOLLOW_UP_DELAYS_MS.length;
export const FOLLOW_UP_DEPARTMENTS = new Set(['technical_support', 'billing', 'sales']);

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/**
 * Aceita somente um pedido inequívoco de autorização, feito pelo assistente.
 * A frase pode variar naturalmente, porém precisa unir retorno/retomada e
 * atualização; uma saudação ou pergunta genérica jamais inicia cadência.
 */
export function isFollowUpConsentPrompt(value: string): boolean {
  const text = normalize(value);
  const asksReturn =
    (text.includes('autoriza') && (text.includes('retome') || text.includes('retornar'))) ||
    text.includes('posso retornar por aqui');
  return asksReturn && text.includes('atualizacao');
}

export function isFollowUpOptOut(value: string): boolean {
  const text = normalize(value);
  return [
    'nao quero receber', 'nao quero mais receber', 'pare de mandar', 'pare de enviar',
    'nao me chame', 'nao entrar em contato', 'remova meu numero', 'cancelar mensagens',
  ].some((term) => text.includes(term));
}

export function isFollowUpConsentAccepted(value: string): boolean {
  const text = normalize(value);
  if (isFollowUpOptOut(text)) return false;
  return /^(sim|s|pode|pode sim|claro|autorizo|pode retornar|pode me chamar|ok|okay)[!. ]*$/.test(text);
}
