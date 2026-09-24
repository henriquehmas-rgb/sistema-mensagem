import { Injectable } from '@nestjs/common';
import { AuditService } from '../../audit/audit.service';
import { IxcService } from '../ixc/ixc.service';
import type { IxcBoxCohortEvidence } from '../ixc/ixc.types';
import { OlhoDeDeusConfigurationService } from './olho-de-deus-configuration.service';

export type BoxNetworkAssessment =
  | 'INSUFFICIENT_EVIDENCE'
  | 'BOX_COHORT_OBSERVED'
  | 'BOX_COHORT_WITH_INDEPENDENT_NETWORK_EVENT';

/**
 * Composição segura IXC -> Olho de Deus.
 *
 * O IXC define a coorte operacional (caixa FTTH). O Olho de Deus fornece uma
 * segunda evidência independente de rede. Enquanto não houver uma associação
 * explícita caixa/região -> evento ODG, a presença de rompimento não confirma
 * que aquela caixa foi afetada; por isso todo o resultado permanece em sombra.
 */
@Injectable()
export class IxcBoxNetworkEvidenceService {
  constructor(
    private readonly ixc: IxcService,
    private readonly olhoDeDeus: OlhoDeDeusConfigurationService,
    private readonly audit: AuditService,
  ) {}

  async evaluate(orgId: string, conversationId: string): Promise<{
    mode: 'SHADOW';
    assessment: BoxNetworkAssessment;
    ixc: IxcBoxCohortEvidence;
    olhoDeDeus: {
      status: 'available' | 'unavailable';
      activeRuptures: number | null;
      observationScope: 'AGGREGATE_ONLY';
    };
    mayConfirmAffectedCustomers: false;
    automatedAction: 'NONE';
  }> {
    const ixc = await this.ixc.collectBoxCohortEvidence(orgId, conversationId);
    let olhoDeDeus: {
      status: 'available' | 'unavailable';
      activeRuptures: number | null;
      observationScope: 'AGGREGATE_ONLY';
    } = { status: 'unavailable', activeRuptures: null, observationScope: 'AGGREGATE_ONLY' };
    try {
      const summary = await this.olhoDeDeus.aggregateSummary();
      olhoDeDeus = {
        status: 'available',
        activeRuptures: summary.ruptures.active,
        observationScope: 'AGGREGATE_ONLY',
      };
    } catch {
      // Mantém a evidência do IXC útil, mas não transforma a falha externa em
      // confirmação nem em um GAP de aprendizagem.
    }
    const assessment: BoxNetworkAssessment = ixc.status !== 'available'
      ? 'INSUFFICIENT_EVIDENCE'
      : olhoDeDeus.activeRuptures && olhoDeDeus.activeRuptures > 0
        ? 'BOX_COHORT_WITH_INDEPENDENT_NETWORK_EVENT'
        : 'BOX_COHORT_OBSERVED';
    const result = {
      mode: 'SHADOW' as const,
      assessment,
      ixc,
      olhoDeDeus,
      mayConfirmAffectedCustomers: false as const,
      automatedAction: 'NONE' as const,
    };
    await this.audit.logSystem(orgId, {
      action: 'ai.network-box-evidence.evaluate',
      entity: 'Conversation',
      entityId: conversationId,
      meta: {
        mode: result.mode,
        assessment: result.assessment,
        ixcStatus: ixc.status,
        boxCount: ixc.boxCount,
        sampleComplete: ixc.sampleComplete,
        activeRuptures: olhoDeDeus.activeRuptures,
        olhoDeDeusStatus: olhoDeDeus.status,
        automatedAction: result.automatedAction,
      },
    });
    return result;
  }
}
