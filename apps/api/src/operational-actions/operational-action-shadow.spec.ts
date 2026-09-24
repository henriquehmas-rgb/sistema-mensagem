import { describe, expect, it } from 'vitest';
import { evaluateShadowAction } from './operational-action-shadow';

const base = {
  allowedActions: ['request_ticket'], forbiddenActions: [], minimumConfidence: 0.8,
  triageConfidence: 0.9, handoff: false, clarification: false,
  evidence: {
    source: 'IXC' as const, customerRef: 'customer_10', status: 'success' as const,
    observedAt: '2026-08-27T12:00:00Z',
    facts: [{ resource: 'contracts' as const, entityRef: 'contract_20', fields: { status: 'A' } }],
  },
};

describe('evaluateShadowAction', () => {
  it('considera elegível somente um cliente e contrato ativos inequívocos', () => {
    expect(evaluateShadowAction(base)).toEqual({
      eligible: true, action: 'request_ticket', customerId: 'customer_10',
      contractId: 'contract_20', reason: null,
    });
  });

  it('bloqueia quando há chamado aberto', () => {
    const result = evaluateShadowAction({
      ...base,
      evidence: { ...base.evidence, facts: [
        ...base.evidence.facts,
        { resource: 'tickets' as const, entityRef: 'ticket_1', fields: { status: 'A' } },
      ] },
    });
    expect(result).toMatchObject({ eligible: false, reason: 'open_duplicate_found' });
  });

  it('aplica o piso global de confiança mesmo quando a skill aceita menos', () => {
    expect(evaluateShadowAction({ ...base, triageConfidence: 0.84 })).toMatchObject({
      eligible: false,
      reason: 'confidence_below_required_minimum',
    });
  });

  it('bloqueia ambiguidade de contrato e ação', () => {
    expect(evaluateShadowAction({
      ...base, allowedActions: ['request_ticket', 'request_service_order'],
    })).toMatchObject({ eligible: false, reason: 'ambiguous_action' });
    expect(evaluateShadowAction({
      ...base,
      evidence: { ...base.evidence, facts: [
        ...base.evidence.facts,
        { resource: 'contracts' as const, entityRef: 'contract_21', fields: { status: 'A' } },
      ] },
    })).toMatchObject({ eligible: false, reason: 'active_contract_ambiguous' });
  });

  it('bloqueia ação individual quando há rompimento coletivo', () => {
    expect(evaluateShadowAction({
      ...base, networkDiagnosis: 'COLLECTIVE_OUTAGE_CONFIRMED',
    })).toMatchObject({
      eligible: false, reason: 'collective_outage_blocks_individual_action',
    });
  });

  it('exige falha individual confirmada antes de considerar uma OS elegível', () => {
    const orderInput = {
      ...base,
      allowedActions: ['request_service_order'],
    };
    expect(evaluateShadowAction(orderInput)).toMatchObject({
      eligible: false, reason: 'service_order_requires_confirmed_individual_failure',
    });
    expect(evaluateShadowAction({
      ...orderInput, networkDiagnosis: 'INDIVIDUAL_FAILURE',
    })).toMatchObject({ eligible: true, action: 'request_service_order' });
  });

  it('bloqueia contexto técnico inconclusivo antes de avaliar duplicidade', () => {
    expect(evaluateShadowAction({
      ...base, networkDiagnosis: 'INCONCLUSIVE',
    })).toMatchObject({ eligible: false, reason: 'network_context_not_actionable' });
  });
});
