import { Inject, Injectable } from '@nestjs/common';
import { OlhoDeDeusCorrelationService } from './olho-de-deus-correlation.service';
import {
  OLHO_DE_DEUS_CONNECTOR,
  type DirectIxcEvidenceState,
  type OlhoDeDeusConnector,
  type OmniNetworkResolution,
} from './olho-de-deus.types';

const TRUSTED_DIRECT_IXC = new Set<DirectIxcEvidenceState>(['success', 'empty']);

/**
 * Ponto único de composição. O IXC direto continua soberano para dados
 * administrativos; Olho de Deus/OLT, para rede. O Omni decide e dispara uma
 * ação autorizada pelo adaptador direto do IXC, que registra o resultado.
 */
@Injectable()
export class OmniNetworkOrchestratorService {
  constructor(
    @Inject(OLHO_DE_DEUS_CONNECTOR) private readonly connector: OlhoDeDeusConnector,
    private readonly correlation: OlhoDeDeusCorrelationService,
  ) {}

  async resolve(
    customerReference: string,
    directIxcState: DirectIxcEvidenceState,
  ): Promise<OmniNetworkResolution> {
    const base = {
      authorities: {
        decisionOwner: 'OMNI' as const,
        triggerOwner: 'OMNI' as const,
        administrative: 'IXC_DIRECT' as const,
        network: 'OLHO_DE_DEUS_OLT' as const,
        operationalExecutor: 'IXC_DIRECT' as const,
        systemOfRecord: 'IXC' as const,
        olhoDeDeusAccess: 'READ_ONLY' as const,
        aiDirectWriteAllowed: false as const,
      },
    };
    if (!this.connector.isConfigured()) {
      return {
        ...base,
        status: 'NOT_CONFIGURED',
        blocksSensitiveAutomation: false,
        context: null,
        reason: 'olho_de_deus_aguardando_integracao_real',
      };
    }
    if (!TRUSTED_DIRECT_IXC.has(directIxcState)) {
      return {
        ...base,
        status: 'INCONCLUSIVE',
        blocksSensitiveAutomation: true,
        context: null,
        reason: 'ixc_direto_nao_resolveu_cliente_com_seguranca',
      };
    }
    try {
      const context = this.correlation.correlate(
        await this.connector.getCustomerNetworkContext(customerReference),
      );
      return {
        ...base,
        status: context.safeForAutomaticReply ? 'RESOLVED' : 'INCONCLUSIVE',
        blocksSensitiveAutomation: !context.safeForAutomaticReply,
        context,
        reason: context.reason,
      };
    } catch {
      return {
        ...base,
        status: 'INCONCLUSIVE',
        blocksSensitiveAutomation: true,
        context: null,
        reason: 'olho_de_deus_indisponivel',
      };
    }
  }
}
