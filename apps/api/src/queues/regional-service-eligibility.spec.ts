import { describe, expect, it } from 'vitest';
import type { IxcOperationalEvidence } from '../integrations/ixc/ixc.types';
import { hasCurrentIxcService } from './regional-service-eligibility';

const evidence = (loginActive: boolean): IxcOperationalEvidence => ({
  source: 'IXC', status: 'success', observedAt: '2026-09-22T20:00:00Z',
  facts: [
    { resource: 'contracts', entityRef: 'c1', fields: { status: 'A' } },
    { resource: 'connections', entityRef: 'l1', fields: { active: loginActive } },
  ],
});

describe('hasCurrentIxcService', () => {
  it('impede que um cadastro histórico seja usado como serviço atual', () => {
    expect(hasCurrentIxcService(evidence(false))).toBe(false);
  });

  it('exige contrato e login ativos antes da consulta regional', () => {
    expect(hasCurrentIxcService(evidence(true))).toBe(true);
    expect(hasCurrentIxcService({ ...evidence(true), facts: evidence(true).facts.slice(1) })).toBe(false);
    expect(hasCurrentIxcService(null)).toBe(false);
  });
});
