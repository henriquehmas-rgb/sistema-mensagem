import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditService } from '../../audit/audit.service';
import { MetricsService } from '../../observability/metrics/metrics.service';
import { IntegrationGovernanceService } from '../integration-governance/integration-governance.service';
import type { SimulateNetworkContextDto } from './dto/simulate-network-context.dto';
import { OlhoDeDeusCorrelationService } from './olho-de-deus-correlation.service';
import { OlhoDeDeusConfigurationService } from './olho-de-deus-configuration.service';
import type { NetworkObservation } from './olho-de-deus.types';

const READ_ONLY_TOOLS = [
  'consultar_contexto_rede_cliente',
  'consultar_status_onu',
  'consultar_status_pon',
  'consultar_status_olt',
  'consultar_sinal_optico',
  'consultar_cto_e_rota',
  'consultar_impacto_coletivo',
  'consultar_rompimento_ativo',
  'consultar_recuperacao_evento',
] as const;

@Injectable()
export class OlhoDeDeusMcpService {
  constructor(
    private readonly correlation: OlhoDeDeusCorrelationService,
    private readonly audit: AuditService,
    private readonly configuration: OlhoDeDeusConfigurationService,
    private readonly governance: IntegrationGovernanceService,
    private readonly metrics: MetricsService,
  ) {}

  async tools() {
    const readiness = await this.configuration.readiness();
    return {
      mode: 'SHADOW' as const,
      transportConfigured: readiness.status === 'READY_FOR_READ_ONLY',
      externalWriteEnabled: false,
      integrationRole: 'NETWORK_EVIDENCE_SOURCE' as const,
      operationalExecutor: 'IXC_DIRECT' as const,
      systemOfRecord: 'IXC' as const,
      aiDirectWriteAllowed: false,
      customerCorrelation: 'PENDING_IXC_TOPOLOGY_MAPPING' as const,
      governance: this.governance.profile('OLHO_DE_DEUS'),
      resultContract: ['CONFIRMED', 'NOT_FOUND', 'UNAVAILABLE', 'AMBIGUOUS'] as const,
      tools: READ_ONLY_TOOLS.map((name) => ({ name, readOnly: true })),
    };
  }

  async simulate(dto: SimulateNetworkContextDto) {
    const observation: NetworkObservation = {
      customerReference: this.pseudonymize(dto.customerReference),
      olt: dto.olt?.trim() || null,
      pon: dto.pon?.trim() || null,
      cto: dto.cto?.trim() || null,
      route: dto.route?.trim() || null,
      onuState: dto.onuState,
      opticalSignalDbm: dto.opticalSignalDbm ?? null,
      affectedOnus: dto.affectedOnus ?? null,
      totalOnus: dto.totalOnus ?? null,
      ixcAlert: dto.ixcAlert ?? null,
      eventState: dto.eventState,
      oltSourceState: dto.oltSourceState,
      ixcSourceState: dto.ixcSourceState,
      observedAt: dto.observedAt,
    };
    const context = this.correlation.correlate(observation);
    const outcome = this.governance.normalizeReadOutcome({
      integration: 'OLHO_DE_DEUS',
      available: dto.oltSourceState === 'AVAILABLE' && dto.ixcSourceState === 'AVAILABLE',
      sufficientEvidence: context.diagnosis !== 'INCONCLUSIVE',
      safeForAutomaticReply: context.safeForAutomaticReply,
      reason: context.reason,
    });
    const sourceStatus = dto.oltSourceState !== 'AVAILABLE' || dto.ixcSourceState !== 'AVAILABLE'
      ? 'UNAVAILABLE'
      : context.diagnosis === 'INCONCLUSIVE'
        ? 'AMBIGUOUS'
        : 'SUCCESS';
    this.metrics.recordMcpIntegrationOutcome(
      'OLHO_DE_DEUS', sourceStatus, outcome.status, outcome.learningDisposition,
    );
    await this.audit.log({
      action: 'olho-de-deus.mcp.correlate.simulate',
      entity: 'NetworkContext',
      entityId: observation.customerReference,
      meta: {
        diagnosis: context.diagnosis,
        safeForAutomaticReply: context.safeForAutomaticReply,
        evidence: context.evidence,
        sourceStatus,
        mcpStatus: outcome.status,
        learningDisposition: outcome.learningDisposition,
      },
    });
    return {
      mode: 'SHADOW' as const,
      externalActionPerformed: false,
      outcome,
      context,
    };
  }

  private pseudonymize(value: string): string {
    return `cust_${createHash('sha256').update(value.trim()).digest('hex').slice(0, 20)}`;
  }
}
