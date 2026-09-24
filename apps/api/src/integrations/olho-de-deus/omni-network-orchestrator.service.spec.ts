import { describe, expect, it, vi } from 'vitest';
import { OlhoDeDeusCorrelationService } from './olho-de-deus-correlation.service';
import type { NetworkObservation, OlhoDeDeusConnector } from './olho-de-deus.types';
import { OmniNetworkOrchestratorService } from './omni-network-orchestrator.service';

const observation: NetworkObservation = {
  customerReference: 'ixc_customer_1',
  olt: 'OLT-1', pon: '0/1/1', cto: 'CTO-1', route: 'R-1',
  onuState: 'ONLINE', opticalSignalDbm: -22, affectedOnus: 0, totalOnus: 64,
  ixcAlert: false, eventState: 'NONE', oltSourceState: 'AVAILABLE', ixcSourceState: 'AVAILABLE',
  observedAt: new Date().toISOString(),
};

function service(connector: OlhoDeDeusConnector) {
  return new OmniNetworkOrchestratorService(connector, new OlhoDeDeusCorrelationService());
}

describe('OmniNetworkOrchestratorService', () => {
  it('não altera o atendimento enquanto a API real não estiver configurada', async () => {
    const connector: OlhoDeDeusConnector = {
      isConfigured: () => false,
      getCustomerNetworkContext: vi.fn(),
    };
    await expect(service(connector).resolve('ixc_customer_1', 'success')).resolves.toMatchObject({
      status: 'NOT_CONFIGURED', blocksSensitiveAutomation: false,
      authorities: {
        decisionOwner: 'OMNI', triggerOwner: 'OMNI', administrative: 'IXC_DIRECT',
        network: 'OLHO_DE_DEUS_OLT', operationalExecutor: 'IXC_DIRECT',
        systemOfRecord: 'IXC', olhoDeDeusAccess: 'READ_ONLY',
        aiDirectWriteAllowed: false,
      },
    });
    expect(connector.getCustomerNetworkContext).not.toHaveBeenCalled();
  });

  it('bloqueia consulta técnica se o IXC direto não identificou o cliente', async () => {
    const connector: OlhoDeDeusConnector = {
      isConfigured: () => true,
      getCustomerNetworkContext: vi.fn(),
    };
    await expect(service(connector).resolve('unknown', 'customer_ambiguous')).resolves.toMatchObject({
      status: 'INCONCLUSIVE', blocksSensitiveAutomation: true,
      reason: 'ixc_direto_nao_resolveu_cliente_com_seguranca',
    });
    expect(connector.getCustomerNetworkContext).not.toHaveBeenCalled();
  });

  it('compõe IXC administrativo e OLT sem conceder escrita ao conector', async () => {
    const connector: OlhoDeDeusConnector = {
      isConfigured: () => true,
      getCustomerNetworkContext: vi.fn().mockResolvedValue(observation),
    };
    await expect(service(connector).resolve('ixc_customer_1', 'success')).resolves.toMatchObject({
      status: 'RESOLVED', blocksSensitiveAutomation: false,
      context: { diagnosis: 'NORMAL', safeForAutomaticReply: true },
      authorities: {
        operationalExecutor: 'IXC_DIRECT',
        olhoDeDeusAccess: 'READ_ONLY',
        aiDirectWriteAllowed: false,
      },
    });
  });

  it('falha fechado quando a API do Olho de Deus fica indisponível', async () => {
    const connector: OlhoDeDeusConnector = {
      isConfigured: () => true,
      getCustomerNetworkContext: vi.fn().mockRejectedValue(new Error('timeout')),
    };
    await expect(service(connector).resolve('ixc_customer_1', 'success')).resolves.toMatchObject({
      status: 'INCONCLUSIVE', blocksSensitiveAutomation: true,
      reason: 'olho_de_deus_indisponivel',
    });
  });
});
