import { describe, expect, it, vi } from 'vitest';
import { IntegrationGovernanceService } from '../integration-governance/integration-governance.service';
import { IxcInmapCoverageService } from './ixc-inmap-coverage.service';

function harness() {
  const ixc = {
    readFtthBoxInventoryByCity: vi.fn(),
    readInmapProjectsInventory: vi.fn(),
    readCoverageRegionTypesInventory: vi.fn(),
    readNegotiationPlansInventory: vi.fn(),
  };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  return {
    ixc,
    audit,
    service: new IxcInmapCoverageService(ixc as never, new IntegrationGovernanceService(), audit as never),
  };
}

describe('IxcInmapCoverageService', () => {
  it('retorna apenas evidência agregada de proximidade e nunca confirma cobertura', async () => {
    const h = harness();
    h.ixc.readFtthBoxInventoryByCity.mockResolvedValue({
      complete: true, declaredTotal: 2, malformedRecordCount: 0,
      items: [
        { active: true, cityId: '77', latitude: -15.6005, longitude: -56.097, reportedCapacity: 16, updatedAt: null },
        { active: true, cityId: '77', latitude: -15.6300, longitude: -56.120, reportedCapacity: 64, updatedAt: null },
      ],
    });

    const result = await h.service.collect({ cityId: '77', latitude: -15.601, longitude: -56.097 });

    expect(result).toMatchObject({
      source: 'IXC_INMAP_FTTH_BOX',
      status: 'CANDIDATES_FOUND',
      activeBoxesInCity: 2,
      inventoryComplete: true,
      nearbyCandidateCount: 1,
      mcpOutcome: {
        status: 'AMBIGUOUS',
        safeForAutomaticReply: false,
        learningDisposition: 'NO_LEARNING_AMBIGUOUS_EVIDENCE',
      },
    });
    expect(result).not.toHaveProperty('reportedCapacity');
    expect(result).not.toHaveProperty('boxId');
  });

  it('classifica indisponibilidade da integração como incidente técnico, não como GAP', async () => {
    const h = harness();
    h.ixc.readFtthBoxInventoryByCity.mockRejectedValue(new Error('IXC indisponível'));

    const result = await h.service.collect({ cityId: '77', latitude: -15.601, longitude: -56.097 });

    expect(result).toMatchObject({
      status: 'UNAVAILABLE',
      mcpOutcome: {
        status: 'UNAVAILABLE',
        learningDisposition: 'NO_LEARNING_TECHNICAL_INCIDENT',
      },
    });
  });

  it('audita a configuração oficial sem converter prontidão em promessa de cobertura', async () => {
    const h = harness();
    h.ixc.readInmapProjectsInventory.mockResolvedValue({ complete: true, items: [{ active: true }] });
    h.ixc.readCoverageRegionTypesInventory.mockResolvedValue({
      complete: true, items: [{ active: true, viabilityEnabled: true, fiberEnabled: true }],
    });
    h.ixc.readNegotiationPlansInventory.mockResolvedValue({
      complete: true, items: [{ active: true, hasSourcePlan: true, hasWorkflow: true, hasInstallationSubject: true }],
    });

    const result = await h.service.inspectOfficialConfiguration();

    expect(result).toMatchObject({
      source: 'IXC_INMAP_CONFIGURATION',
      status: 'CONFIGURATION_SIGNALS_PRESENT',
      configurationInventoryComplete: true,
      activeProjectCount: 1,
      viableFiberRegionTypeCount: 1,
      negotiationPlansWithSourcePlan: 1,
      mcpOutcome: {
        status: 'AMBIGUOUS',
        safeForAutomaticReply: false,
        learningDisposition: 'NO_LEARNING_AMBIGUOUS_EVIDENCE',
      },
    });
  });

  it('não conclui ausência de caixa quando a leitura por cidade foi truncada', async () => {
    const h = harness();
    h.ixc.readFtthBoxInventoryByCity.mockResolvedValue({
      complete: false, declaredTotal: 400, malformedRecordCount: 0,
      items: Array.from({ length: 250 }, () => ({ active: true, latitude: -10, longitude: -50 })),
    });

    const result = await h.service.collect({ cityId: '77', latitude: -15.601, longitude: -56.097 });

    expect(result).toMatchObject({
      status: 'INVENTORY_LIMIT_REACHED', inventoryComplete: false,
      mcpOutcome: { status: 'AMBIGUOUS', safeForAutomaticReply: false },
    });
  });

  it('classifica uma fonte de configuração indisponível como incidente técnico', async () => {
    const h = harness();
    h.ixc.readInmapProjectsInventory.mockResolvedValue({ complete: true, items: [{ active: true }] });
    h.ixc.readCoverageRegionTypesInventory.mockRejectedValue(new Error('IXC indisponível'));
    h.ixc.readNegotiationPlansInventory.mockResolvedValue({ complete: true, items: [] });

    const result = await h.service.inspectOfficialConfiguration();

    expect(result).toMatchObject({
      status: 'PARTIAL_UNAVAILABLE', availableSourceCount: 2,
      mcpOutcome: { status: 'UNAVAILABLE', learningDisposition: 'NO_LEARNING_TECHNICAL_INCIDENT' },
    });
  });
});
