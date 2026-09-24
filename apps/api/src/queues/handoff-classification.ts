/**
 * Classifica o motivo devolvido pela IA antes de criar conhecimento pendente.
 * Falhas de infraestrutura, identidade ou provedor não ensinam o Omni e nunca
 * devem poluir a fila de RAG. Baixa confiança também vira revisão operacional,
 * pois a busca/skill já foi executada pela IA antes do handoff.
 */
export type HandoffDisposition = 'KNOWLEDGE_GAP' | 'TECHNICAL_INCIDENT' | 'OPERATIONAL_REVIEW';

export interface HandoffClassification {
  disposition: HandoffDisposition;
  auditReason: string;
}

const TECHNICAL_INCIDENT_PATTERNS = [
  'fonte_operacional_indisponivel',
  'integracao_indisponivel',
  'falha_na_integracao',
  'ixc_indisponivel',
  'olho_de_deus_indisponivel',
  'falha_no_provedor_llm',
  'falha_nos_provedores_llm',
  'tempo_limite_do_llm_excedido',
  'erro_interno_no_servico_de_ia',
  'falha_na_revisao_da_resposta',
  'tempo_limite',
  'timeout',
  'provedor',
  'servico_de_ia',
  'credencial',
  'cliente_ambiguo_no_ixc',
  'cliente_nao_localizado_no_ixc',
  'contexto_tecnico_inconclusivo',
  'identidade',
  'validacao',
];

const REAL_KNOWLEDGE_GAP_REASONS = new Set([
  'sem_contexto_na_base_de_conhecimento',
  'contexto_insuficiente',
]);

export function classifyHandoff(reason: string | undefined): HandoffClassification {
  const normalized = (reason ?? 'contexto_insuficiente').trim().toLowerCase();
  if (TECHNICAL_INCIDENT_PATTERNS.some((pattern) => normalized.includes(pattern))) {
    return { disposition: 'TECHNICAL_INCIDENT', auditReason: normalized };
  }
  if (REAL_KNOWLEDGE_GAP_REASONS.has(normalized)) {
    return { disposition: 'KNOWLEDGE_GAP', auditReason: normalized };
  }
  return { disposition: 'OPERATIONAL_REVIEW', auditReason: normalized };
}
