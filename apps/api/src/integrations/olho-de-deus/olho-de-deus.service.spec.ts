import { describe, expect, it, vi } from 'vitest';
import { OlhoDeDeusService } from './olho-de-deus.service';

describe('OlhoDeDeusService', () => {
  const notConfigured = { readiness: vi.fn().mockResolvedValue({ status: 'NOT_CONFIGURED' }) };
  const noTopology = { readiness: vi.fn().mockResolvedValue({ confirmed: 0 }) };

  it('não anuncia capacidades ainda não confirmadas como disponíveis', async () => {
    const service = new OlhoDeDeusService({ log: vi.fn() } as never, notConfigured as never, noTopology as never);
    await expect(service.capabilities()).resolves.toMatchObject({
      status: 'AWAITING_CONFIGURATION', configured: false, externalWriteEnabled: false,
      confirmed: {
        monitorsOlts: true, enrichesAffectedCustomersFromIxc: true, apiCanBeProvided: true,
      },
      integrationContract: {
        access: 'READ_ONLY',
        role: 'NETWORK_EVIDENCE_SOURCE', mayBeTriggeredByOmni: false,
        operationalExecutor: 'IXC_DIRECT', systemOfRecord: 'IXC',
        decisionOwner: 'OMNI', aiDirectWriteAllowed: false,
      },
      pendingConfirmation: {
        readsEventsProgrammatically: true,
        ixctopologyCorrelation: true,
      },
      mcpMode: 'SHADOW',
    });
  });

  it('normaliza somente em simulação, sem executar ação externa', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const service = new OlhoDeDeusService(audit as never, notConfigured as never, noTopology as never);
    const result = await service.normalizeForSimulation({
      externalEventId: '12196830', status: 'DOWN', olt: 'CARAMUJO', pon: '0/1/9', affectedCustomers: 42,
    });
    expect(result).toMatchObject({
      mode: 'SIMULATION', suggestedIntent: 'mass_network_outage', externalActionPerformed: false,
      event: { olt: 'CARAMUJO', pon: '0/1/9', affectedCustomers: 42 },
    });
    expect(result.eventKey).toHaveLength(64);
    expect(audit.log).toHaveBeenCalled();
  });
});
