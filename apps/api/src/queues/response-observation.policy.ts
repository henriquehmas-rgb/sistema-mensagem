/**
 * Metadados de auditoria para uma resposta da IA.
 *
 * Não interferem no texto, no encaminhamento nem no runtime. Eles existem para
 * que o painel não trate uma saudação ou uma pergunta de diagnóstico como uma
 * afirmação factual sem fonte. Quando não há evidência suficiente para decidir,
 * a resposta fica explicitamente como UNCLASSIFIED, nunca como falha automática.
 */
export type TraceExpectation = 'REQUIRED' | 'NOT_REQUIRED' | 'UNCLASSIFIED';

export interface ResponseObservationInput {
  reply: string;
  clarification: boolean;
  sources: string[];
  identityRequiredNow: boolean;
  identityVerified: boolean;
  caseNextStep: string | null | undefined;
}

export interface ResponseObservation {
  traceExpectation: TraceExpectation;
  traceReason: 'source_backed' | 'clarification' | 'social_or_closure' | 'needs_review';
  clarificationKey: string | null;
  sequence?: { route: string; nextStep: string | null; decision: 'PASS' | 'REPLACE'; reason: string };
}

const SOCIAL_OR_CLOSURE = /^(?:ol[áa]|oi|bom dia|boa tarde|boa noite|obrigad[oa]|por nada|que bom|perfeito,?\s*(?:obrigad[oa])?|conte comigo|fico à disposiç[ãa]o)/i;

/**
 * Produz chaves estáveis para detectar a REPETIÇÃO do mesmo passo, e não a
 * mera presença de duas perguntas válidas numa conversa mais longa.
 */
export function clarificationKeyFor(input: ResponseObservationInput): string | null {
  if (!input.clarification) return null;
  if (!input.identityVerified && input.identityRequiredNow) return 'IDENTITY_VERIFICATION';
  const nextStep = (input.caseNextStep ?? '').trim().toUpperCase();
  return nextStep ? `CASE_STEP:${nextStep}` : 'UNSPECIFIED';
}

export function observeAiReply(input: ResponseObservationInput): ResponseObservation {
  const clarificationKey = clarificationKeyFor(input);
  if (input.sources.length > 0) {
    return { traceExpectation: 'REQUIRED', traceReason: 'source_backed', clarificationKey };
  }
  if (input.clarification) {
    return { traceExpectation: 'NOT_REQUIRED', traceReason: 'clarification', clarificationKey };
  }
  if (SOCIAL_OR_CLOSURE.test(input.reply.trim())) {
    return { traceExpectation: 'NOT_REQUIRED', traceReason: 'social_or_closure', clarificationKey };
  }
  // Não deduzimos que uma resposta sem fonte esteja errada. Ela será exibida
  // como amostra a categorizar, impedindo que uma métrica imprecisa bloqueie
  // (ou libere) o setor por engano.
  return { traceExpectation: 'UNCLASSIFIED', traceReason: 'needs_review', clarificationKey };
}
