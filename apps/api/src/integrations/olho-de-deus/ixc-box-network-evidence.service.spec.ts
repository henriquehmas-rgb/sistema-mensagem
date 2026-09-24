import { describe, expect, it, vi } from 'vitest';
import { IxcBoxNetworkEvidenceService } from './ixc-box-network-evidence.service';

const cohort = (status: 'available' | 'no_box' | 'box_ambiguous' | 'unavailable') => ({
  source: 'IXC_FTTH_BOX' as const,
  status,
  observedAt: '2026-09-09T12:00:00.000Z',
  boxCount: status === 'available' ? 1 : 0,
  sampleComplete: true,
  connections: { total: 8, active: 8, online: 6, offline: 2, unknown: 0 },
});

describe('IxcBoxNetworkEvidenceService', () => {
  it('mantém evento ODG agregado como corroboração, sem confirmar clientes afetados', async () => {
    const ixc = { collectBoxCohortEvidence: vi.fn().mockResolvedValue(cohort('available')) };
    const odg = { aggregateSummary: vi.fn().mockResolvedValue({ ruptures: { active: 1 } }) };
    const audit = { logSystem: vi.fn().mockResolvedValue(undefined) };
    const service = new IxcBoxNetworkEvidenceService(ixc as never, odg as never, audit as never);

    await expect(service.evaluate('org_seeg', 'conv_1')).resolves.toMatchObject({
      mode: 'SHADOW',
      assessment: 'BOX_COHORT_WITH_INDEPENDENT_NETWORK_EVENT',
      mayConfirmAffectedCustomers: false,
      automatedAction: 'NONE',
      olhoDeDeus: { status: 'available', observationScope: 'AGGREGATE_ONLY' },
    });
  });

  it('não transforma indisponibilidade em evento coletivo', async () => {
    const ixc = { collectBoxCohortEvidence: vi.fn().mockResolvedValue(cohort('unavailable')) };
    const odg = { aggregateSummary: vi.fn().mockRejectedValue(new Error('offline')) };
    const audit = { logSystem: vi.fn().mockResolvedValue(undefined) };
    const service = new IxcBoxNetworkEvidenceService(ixc as never, odg as never, audit as never);

    await expect(service.evaluate('org_seeg', 'conv_1')).resolves.toMatchObject({
      assessment: 'INSUFFICIENT_EVIDENCE',
      olhoDeDeus: { status: 'unavailable' },
      automatedAction: 'NONE',
    });
  });
});
