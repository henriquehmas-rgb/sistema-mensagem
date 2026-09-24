/**
 * Converte indisponibilidades observadas pelo runtime em um motivo canônico
 * de incidente. O modelo continua responsável por conversar e pode sinalizar
 * handoff, mas uma falha de fonte nunca pode virar candidato de conhecimento
 * apenas porque a resposta do modelo usou um motivo genérico.
 */
export interface TechnicalResilienceInput {
  ixcEvidenceStatus?: 'success' | 'empty' | 'customer_not_found' | 'customer_ambiguous' | 'unavailable' | null;
  networkReason?: string | null;
}

export function technicalIncidentReason(input: TechnicalResilienceInput): string | null {
  if (input.ixcEvidenceStatus === 'unavailable') return 'ixc_indisponivel';
  if (input.networkReason === 'olho_de_deus_indisponivel') return 'olho_de_deus_indisponivel';
  return null;
}

/**
 * A causa factual de uma fonte indisponível tem precedência sobre uma razão
 * ampla emitida pelo modelo, sem reclassificar um caso que possua evidência
 * operacional disponível.
 */
export function resilientHandoffReason(
  modelReason: string | undefined,
  input: TechnicalResilienceInput,
): string | undefined {
  return technicalIncidentReason(input) ?? modelReason;
}
