import { describe, expect, it } from 'vitest';
import { IntegrationGovernanceService } from './integration-governance.service';

describe('IntegrationGovernanceService', () => {
  const service = new IntegrationGovernanceService();

  it('separa indisponibilidade técnica de GAP de aprendizagem', () => {
    expect(service.normalizeReadOutcome({ integration: 'IXC', available: false, reason: 'timeout' }))
      .toMatchObject({ status: 'UNAVAILABLE', retryable: true, learningDisposition: 'NO_LEARNING_TECHNICAL_INCIDENT' });
  });

  it('mantém evidência ambígua fora da aprendizagem automática', () => {
    expect(service.normalizeReadOutcome({ integration: 'OLHO_DE_DEUS', available: true, sufficientEvidence: false, reason: 'sem correlacao' }))
      .toMatchObject({ status: 'AMBIGUOUS', safeForAutomaticReply: false, learningDisposition: 'NO_LEARNING_AMBIGUOUS_EVIDENCE' });
  });

  it('declara que nenhuma integração externa possui escrita habilitada', () => {
    expect(service.profile('IXC')).toMatchObject({ systemOfRecord: 'IXC', externalWriteEnabled: false, humanApprovalRequiredForWrites: true });
    expect(service.profile('OLHO_DE_DEUS')).toMatchObject({ readOnly: true, role: 'NETWORK_EVIDENCE_SOURCE', externalWriteEnabled: false });
  });
});
