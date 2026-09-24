import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { MetricsCoreModule } from '../../observability/metrics/metrics-core.module';
import { IxcModule } from '../ixc/ixc.module';
import { IntegrationGovernanceModule } from '../integration-governance/integration-governance.module';
import { OlhoDeDeusController } from './olho-de-deus.controller';
import { OlhoDeDeusConfigurationService } from './olho-de-deus-configuration.service';
import { OlhoDeDeusCorrelationService } from './olho-de-deus-correlation.service';
import { OlhoDeDeusDisabledConnector } from './olho-de-deus-disabled.connector';
import { OlhoDeDeusMcpService } from './olho-de-deus-mcp.service';
import { OlhoDeDeusService } from './olho-de-deus.service';
import { OLHO_DE_DEUS_CONNECTOR } from './olho-de-deus.types';
import { OmniNetworkOrchestratorService } from './omni-network-orchestrator.service';
import { NetworkTopologyMappingService } from './network-topology-mapping.service';
import { IxcBoxNetworkEvidenceService } from './ixc-box-network-evidence.service';

@Module({
  imports: [AuditModule, IxcModule, IntegrationGovernanceModule, MetricsCoreModule],
  controllers: [OlhoDeDeusController],
  providers: [
    OlhoDeDeusService,
    OlhoDeDeusConfigurationService,
    OlhoDeDeusCorrelationService,
    OlhoDeDeusMcpService,
    NetworkTopologyMappingService,
    IxcBoxNetworkEvidenceService,
    OlhoDeDeusDisabledConnector,
    { provide: OLHO_DE_DEUS_CONNECTOR, useExisting: OlhoDeDeusDisabledConnector },
    OmniNetworkOrchestratorService,
  ],
  exports: [
    OlhoDeDeusService,
    OlhoDeDeusCorrelationService,
    OlhoDeDeusMcpService,
    NetworkTopologyMappingService,
    IxcBoxNetworkEvidenceService,
    OmniNetworkOrchestratorService,
  ],
})
export class OlhoDeDeusModule {}
