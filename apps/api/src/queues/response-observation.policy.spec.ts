import { describe, expect, it } from 'vitest';
import { observeAiReply } from './response-observation.policy';

const base = {
  reply: 'Olá, como posso ajudar?',
  clarification: false,
  sources: [] as string[],
  identityRequiredNow: false,
  identityVerified: false,
  caseNextStep: null,
};

describe('observeAiReply', () => {
  it('não cobra fonte de uma saudação social', () => {
    expect(observeAiReply(base)).toMatchObject({
      traceExpectation: 'NOT_REQUIRED',
      traceReason: 'social_or_closure',
    });
  });

  it('marca respostas com fonte como rastreáveis', () => {
    expect(observeAiReply({ ...base, reply: 'Sua fatura vence dia 10.', sources: ['ixc:invoice'] }))
      .toMatchObject({ traceExpectation: 'REQUIRED', traceReason: 'source_backed' });
  });

  it('distingue confirmação de identidade de outra pergunta de diagnóstico', () => {
    expect(observeAiReply({ ...base, clarification: true, identityRequiredNow: true }))
      .toMatchObject({ traceExpectation: 'NOT_REQUIRED', clarificationKey: 'IDENTITY_VERIFICATION' });
    expect(observeAiReply({ ...base, clarification: true, caseNextStep: 'ASK_ROUTER_DISTANCE' }))
      .toMatchObject({ clarificationKey: 'CASE_STEP:ASK_ROUTER_DISTANCE' });
  });

  it('não inventa uma exigência de fonte para resposta sem classificação', () => {
    expect(observeAiReply({ ...base, reply: 'A conexão parece instável.' }))
      .toMatchObject({ traceExpectation: 'UNCLASSIFIED', traceReason: 'needs_review' });
  });
});
