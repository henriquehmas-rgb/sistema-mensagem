/**
 * Critérios conservadores de liberação por setor.
 *
 * Isto não habilita nenhuma ação nem substitui a revisão humana. O objetivo é
 * tornar explícito quando a amostra observada sustenta somente homologação,
 * uso controlado ou uma pausa para correção. Incidentes de integração ficam
 * visíveis como alerta, sem serem confundidos com deficiência de conhecimento.
 */
export type OperationalSectorKey = 'technical_support' | 'billing' | 'sales';
export type OperationalReadinessStatus = 'HOLD' | 'SHADOW_ONLY' | 'CONTROLLED_USE';

export interface OperationalReadinessInput {
  sector: OperationalSectorKey;
  conversations: number;
  /** Conversas da amostra que vieram de canal externo, não do Webchat sombra. */
  externalChannelConversations: number;
  triageConflicts: number;
  lowConfidenceTriages: number;
  /** Cautela do modelo sem uma rota concorrente: observar, mas não bloquear. */
  lowConfidenceWithoutAlternative?: number;
  /** Conversas únicas com conflito OU baixa confiança; evita dupla contagem. */
  triageAttentionConversations?: number;
  conversationsWithRepeatedClarification: number;
  pendingKnowledgeGaps: number;
  pendingShadowProposals: number;
  aiRepliesWithTrace: number;
  aiRepliesWithoutTrace: number;
  unclassifiedAiReplies: number;
  technicalIncidents: number;
  operationalReviews: number;
}

export interface OperationalReadinessResult {
  sector: OperationalSectorKey;
  status: OperationalReadinessStatus;
  minimumSample: number;
  conversations: number;
  externalChannelConversations: number;
  /** A qualidade pode estar validada em sombra, mas só canal externo é evidência de piloto real. */
  evidenceScope: 'WEBCHAT_SHADOW' | 'EXTERNAL_PILOT';
  triageAttentionConversations: number;
  lowConfidenceWithoutAlternative: number;
  triageAttentionRate: number | null;
  repeatedClarificationRate: number | null;
  traceCoverage: number | null;
  blockers: string[];
  advisories: string[];
  nextAction: string;
}

export const OPERATIONAL_RELEASE_THRESHOLDS = {
  minimumSample: 30,
  maxTriageAttentionRate: 0.05,
  maxRepeatedClarificationRate: 0.1,
  minimumTraceSample: 30,
  minimumTraceCoverage: 0.9,
} as const;

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/** Produz uma decisão explicável; não muda estado persistido nem habilita escrita. */
export function assessOperationalReadiness(input: OperationalReadinessInput): OperationalReadinessResult {
  const triageAttentionConversations = input.triageAttentionConversations
    ?? input.triageConflicts + input.lowConfidenceTriages;
  const triageAttentionRate = rate(triageAttentionConversations, input.conversations);
  const repeatedClarificationRate = rate(input.conversationsWithRepeatedClarification, input.conversations);
  const traceTotal = input.aiRepliesWithTrace + input.aiRepliesWithoutTrace;
  const traceCoverage = rate(input.aiRepliesWithTrace, traceTotal);
  const blockers: string[] = [];
  const advisories: string[] = [];
  const evidenceScope = input.externalChannelConversations > 0 ? 'EXTERNAL_PILOT' : 'WEBCHAT_SHADOW';

  if (input.conversations < OPERATIONAL_RELEASE_THRESHOLDS.minimumSample) {
    blockers.push(`amostra insuficiente: ${input.conversations}/${OPERATIONAL_RELEASE_THRESHOLDS.minimumSample} conversas`);
  }

  // Só avaliamos percentuais depois de haver amostra suficiente. Antes disso,
  // a conclusão segura é modo sombra, nunca reprovação por ruído estatístico.
  if (input.conversations >= OPERATIONAL_RELEASE_THRESHOLDS.minimumSample) {
    if ((triageAttentionRate ?? 0) > OPERATIONAL_RELEASE_THRESHOLDS.maxTriageAttentionRate) {
      blockers.push('triagem acima do limite de 5%');
    }
    if ((repeatedClarificationRate ?? 0) > OPERATIONAL_RELEASE_THRESHOLDS.maxRepeatedClarificationRate) {
      blockers.push('confirmações repetidas acima do limite de 10%');
    }
  }

  if (input.pendingKnowledgeGaps > 0) {
    blockers.push(`${input.pendingKnowledgeGaps} GAP(s) factual(is) aguardando curadoria`);
  }
  if (input.pendingShadowProposals > 0) {
    blockers.push(`${input.pendingShadowProposals} proposta(s) operacional(is) ainda em modo sombra`);
  }

  // Rastro é insumo de auditoria: saudações e encerramentos podem ser válidos
  // sem fonte, portanto ele gera alerta e não bloqueio automático.
  if (traceTotal >= OPERATIONAL_RELEASE_THRESHOLDS.minimumTraceSample
    && (traceCoverage ?? 0) < OPERATIONAL_RELEASE_THRESHOLDS.minimumTraceCoverage) {
    advisories.push('amostra de rastreabilidade abaixo de 90%; revisar respostas factuais manualmente');
  }
  if (input.technicalIncidents > 0) {
    advisories.push(`${input.technicalIncidents} incidente(s) técnico(s): acompanhar integração, sem gerar aprendizagem`);
  }
  if (input.unclassifiedAiReplies > 0) {
    advisories.push(`${input.unclassifiedAiReplies} resposta(s) ainda sem classificação de rastreabilidade; revisar antes de concluir a amostra`);
  }
  if ((input.lowConfidenceWithoutAlternative ?? 0) > 0) {
    advisories.push(`${input.lowConfidenceWithoutAlternative} classificação(ões) cautelosa(s) sem rota concorrente; acompanhar sem tratar como conflito`);
  }
  if (input.operationalReviews > 0) {
    advisories.push(`${input.operationalReviews} revisão(ões) operacional(is) pendente(s) de análise humana`);
  }
  if (evidenceScope === 'WEBCHAT_SHADOW') {
    advisories.push('amostra atual é de Webchat em modo sombra; ela valida estrutura, não substitui piloto externo real');
  }

  const hasQualityFailure = input.conversations >= OPERATIONAL_RELEASE_THRESHOLDS.minimumSample
    && ((triageAttentionRate ?? 0) > OPERATIONAL_RELEASE_THRESHOLDS.maxTriageAttentionRate
      || (repeatedClarificationRate ?? 0) > OPERATIONAL_RELEASE_THRESHOLDS.maxRepeatedClarificationRate);
  const status: OperationalReadinessStatus = hasQualityFailure
    ? 'HOLD'
    : blockers.length > 0
      ? 'SHADOW_ONLY'
      : 'CONTROLLED_USE';

  return {
    sector: input.sector,
    status,
    minimumSample: OPERATIONAL_RELEASE_THRESHOLDS.minimumSample,
    conversations: input.conversations,
    externalChannelConversations: input.externalChannelConversations,
    evidenceScope,
    triageAttentionConversations,
    lowConfidenceWithoutAlternative: input.lowConfidenceWithoutAlternative ?? 0,
    triageAttentionRate,
    repeatedClarificationRate,
    traceCoverage,
    blockers,
    advisories,
    nextAction: status === 'CONTROLLED_USE'
      ? 'manter monitoramento diário e escrita operacional bloqueada'
      : status === 'HOLD'
        ? 'corrigir regressão antes de continuar a homologação'
        : 'concluir amostra, curadoria e modo sombra antes de liberar uso controlado',
  };
}
