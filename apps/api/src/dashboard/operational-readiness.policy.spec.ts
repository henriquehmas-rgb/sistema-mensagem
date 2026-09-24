import { describe, expect, it } from 'vitest';
import { assessOperationalReadiness } from './operational-readiness.policy';

const baseline = {
  sector: 'technical_support' as const,
  conversations: 30,
  externalChannelConversations: 0,
  triageConflicts: 0,
  lowConfidenceTriages: 1,
  lowConfidenceWithoutAlternative: 1,
  conversationsWithRepeatedClarification: 3,
  pendingKnowledgeGaps: 0,
  pendingShadowProposals: 0,
  aiRepliesWithTrace: 24,
  aiRepliesWithoutTrace: 6,
  unclassifiedAiReplies: 0,
  technicalIncidents: 2,
  operationalReviews: 1,
};

describe('assessOperationalReadiness', () => {
  it('permite uso controlado com amostra e qualidade aprovadas', () => {
    expect(assessOperationalReadiness(baseline)).toMatchObject({
      status: 'CONTROLLED_USE',
      triageAttentionRate: 1 / 30,
      repeatedClarificationRate: 0.1,
    });
  });

  it('mantém pouca amostra em modo sombra, sem chamar isso de falha', () => {
    expect(assessOperationalReadiness({ ...baseline, conversations: 12 })).toMatchObject({
      status: 'SHADOW_ONLY',
    });
  });

  it('interrompe liberação quando há regressão de triagem ou repetição', () => {
    expect(assessOperationalReadiness({ ...baseline, lowConfidenceTriages: 2 })).toMatchObject({ status: 'HOLD' });
    expect(assessOperationalReadiness({ ...baseline, conversationsWithRepeatedClarification: 4 })).toMatchObject({ status: 'HOLD' });
  });

  it('não transforma incidente técnico em bloqueio de aprendizagem', () => {
    const result = assessOperationalReadiness({ ...baseline, technicalIncidents: 5 });
    expect(result.status).toBe('CONTROLLED_USE');
    expect(result.advisories.join(' ')).toContain('sem gerar aprendizagem');
  });

  it('declara a diferença entre validação em sombra e piloto externo', () => {
    expect(assessOperationalReadiness(baseline).evidenceScope).toBe('WEBCHAT_SHADOW');
    expect(assessOperationalReadiness({ ...baseline, externalChannelConversations: 1 }).evidenceScope)
      .toBe('EXTERNAL_PILOT');
  });

  it('mantém baixa confiança sem rota concorrente como alerta, não como bloqueio', () => {
    const result = assessOperationalReadiness({
      ...baseline,
      lowConfidenceTriages: 10,
      lowConfidenceWithoutAlternative: 10,
      triageAttentionConversations: 0,
    });
    expect(result.status).toBe('CONTROLLED_USE');
    expect(result.advisories.join(' ')).toContain('sem rota concorrente');
  });

  it('usa conversas únicas quando conflito e baixa confiança coexistem', () => {
    const result = assessOperationalReadiness({
      ...baseline,
      conversations: 40,
      triageConflicts: 2,
      lowConfidenceTriages: 3,
      triageAttentionConversations: 4,
    });
    expect(result.triageAttentionConversations).toBe(4);
    expect(result.triageAttentionRate).toBe(0.1);
  });
});
