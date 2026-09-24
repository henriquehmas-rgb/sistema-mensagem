/**
 * Contingência de última tentativa do provedor de IA. Não afirma diagnóstico,
 * não cria GAP e não solicita que a pessoa repita um relato que já está
 * persistido no CRM.
 */
export const AI_REPLY_CONTINGENCY_REASON = 'falha_no_provedor_llm';

export function isFinalAiReplyAttempt(attemptsMade: number, configuredAttempts: number | undefined): boolean {
  const totalAttempts = typeof configuredAttempts === 'number' && configuredAttempts > 0
    ? configuredAttempts
    : 1;
  return attemptsMade + 1 >= totalAttempts;
}

export function aiReplyContingencyMessage(): string {
  return 'Tive uma instabilidade momentânea por aqui. Seu relato continua registrado, então você não precisa repetir o que já me explicou. Pode me chamar novamente em alguns minutos que seguimos deste ponto.';
}
