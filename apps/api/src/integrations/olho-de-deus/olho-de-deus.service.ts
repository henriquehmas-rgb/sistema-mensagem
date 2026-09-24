import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AuditService } from '../../audit/audit.service';
import type { NormalizeNetworkEventDto } from './dto/normalize-network-event.dto';
import { OlhoDeDeusConfigurationService } from './olho-de-deus-configuration.service';
import { NetworkTopologyMappingService } from './network-topology-mapping.service';

@Injectable()
export class OlhoDeDeusService {
  constructor(
    private readonly audit: AuditService,
    private readonly configuration: OlhoDeDeusConfigurationService,
    private readonly topologyMappings: NetworkTopologyMappingService,
  ) {}

  async capabilities() {
    const [readiness, topology] = await Promise.all([
      this.configuration.readiness(),
      this.topologyMappings.readiness(),
    ]);
    const readOnlyReady = readiness.status === 'READY_FOR_READ_ONLY';
    return {
      status: readOnlyReady ? ('READ_ONLY_SHADOW_READY' as const) : ('AWAITING_CONFIGURATION' as const),
      configured: readOnlyReady,
      confirmed: {
        monitorsOlts: true,
        enrichesAffectedCustomersFromIxc: true,
        publishesDiscordAlerts: true,
        apiCanBeProvided: true,
      },
      integrationContract: {
        access: 'READ_ONLY' as const,
        role: 'NETWORK_EVIDENCE_SOURCE' as const,
        mayBeTriggeredByOmni: false,
        operationalExecutor: 'IXC_DIRECT' as const,
        systemOfRecord: 'IXC' as const,
        decisionOwner: 'OMNI' as const,
        aiDirectWriteAllowed: false,
      },
      pendingConfirmation: {
        readsEventsProgrammatically: !readOnlyReady,
        ixctopologyCorrelation: topology.confirmed === 0,
      },
      topologyMapping: topology,
      externalWriteEnabled: false,
      mcpMode: 'SHADOW' as const,
    };
  }

  async normalizeForSimulation(dto: NormalizeNetworkEventDto) {
    const eventKey = createHash('sha256')
      .update([dto.externalEventId, dto.status, dto.olt, dto.pon ?? '', dto.route ?? ''].join(':'))
      .digest('hex');
    const result = {
      mode: 'SIMULATION' as const,
      eventKey,
      event: {
        externalEventId: dto.externalEventId,
        status: dto.status,
        olt: dto.olt,
        pon: dto.pon ?? null,
        route: dto.route ?? null,
        affectedCustomers: dto.affectedCustomers ?? null,
        source: dto.source ?? 'OLHO_DE_DEUS',
        occurredAt: dto.occurredAt ?? null,
      },
      suggestedIntent: dto.status === 'DOWN' ? 'mass_network_outage' : 'network_recovered',
      externalActionPerformed: false,
    };
    await this.audit.log({
      action: 'olho-de-deus.event.normalize.simulate', entity: 'NetworkEvent', entityId: eventKey,
      meta: { status: dto.status, hasAffectedCustomerCount: dto.affectedCustomers !== undefined },
    });
    return result;
  }
}
