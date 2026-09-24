import { describe, expect, it, vi } from 'vitest';
import { OlhoDeDeusCorrelationService } from './olho-de-deus-correlation.service';
import { OlhoDeDeusMcpService } from './olho-de-deus-mcp.service';
import { IntegrationGovernanceService } from '../integration-governance/integration-governance.service';
import { MetricsService } from '../../observability/metrics/metrics.service';

describe('OlhoDeDeusMcpService', () => {
  const configuration = { readiness: vi.fn().mockResolvedValue({ status: 'READY_FOR_READ_ONLY' }) };

  it('expõe somente ferramentas de leitura em modo sombra', async () => {
    const service = new OlhoDeDeusMcpService(
      new OlhoDeDeusCorrelationService(), { log: vi.fn() } as never,
      configuration as never, new IntegrationGovernanceService(), new MetricsService(),
    );
    const result = await service.tools();
    expect(result).toMatchObject({
      mode: 'SHADOW', externalWriteEnabled: false,
      integrationRole: 'NETWORK_EVIDENCE_SOURCE',
      operationalExecutor: 'IXC_DIRECT', systemOfRecord: 'IXC', aiDirectWriteAllowed: false,
    });
    expect(result.governance).toMatchObject({ readOnly: true, externalWriteEnabled: false });
    expect(result.tools.length).toBeGreaterThan(5);
    expect(result.tools.every((tool) => tool.readOnly)).toBe(true);
  });

  it('pseudonimiza cliente, audita e nunca executa ação externa', async () => {
    const audit = { log: vi.fn().mockResolvedValue(undefined) };
    const metrics = { recordMcpIntegrationOutcome: vi.fn() };
    const service = new OlhoDeDeusMcpService(
      new OlhoDeDeusCorrelationService(), audit as never,
      configuration as never, new IntegrationGovernanceService(), metrics as never,
    );
    const rawReference = '12345678901';
    const result = await service.simulate({
      customerReference: rawReference,
      olt: 'X15', pon: '0/3/8', cto: '607-A', route: 'A',
      onuState: 'ONLINE', opticalSignalDbm: -25,
      affectedOnus: 0, totalOnus: 80, ixcAlert: false, eventState: 'NONE',
      oltSourceState: 'AVAILABLE', ixcSourceState: 'AVAILABLE',
      observedAt: new Date().toISOString(),
    });
    expect(result.externalActionPerformed).toBe(false);
    expect(result.outcome.status).toBe('CONFIRMED');
    expect(result.context.customerReference).toMatch(/^cust_[a-f0-9]{20}$/);
    expect(JSON.stringify(result)).not.toContain(rawReference);
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'olho-de-deus.mcp.correlate.simulate',
    }));
    expect(metrics.recordMcpIntegrationOutcome).toHaveBeenCalledWith(
      'OLHO_DE_DEUS', 'SUCCESS', 'CONFIRMED', 'ELIGIBLE_FOR_REVIEW',
    );
  });
});
