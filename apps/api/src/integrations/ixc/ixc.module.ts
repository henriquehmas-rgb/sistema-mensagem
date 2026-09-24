import { Module } from '@nestjs/common';
import { MetricsCoreModule } from '../../observability/metrics/metrics-core.module';
import { IntegrationGovernanceModule } from '../integration-governance/integration-governance.module';
import { SupportCaseStateModule } from '../../support-case-state/support-case-state.module';
import { IxcController } from './ixc.controller';
import { IxcHttpClient } from './ixc-http.client';
import { IxcService } from './ixc.service';
import { IxcEvidenceCache } from './ixc-evidence-cache';
import { IdentityAttemptLimiter } from './identity-attempt-limiter';
import { IxcWriteExecutor } from './ixc-write-executor';
import { IxcInmapCoverageService } from './ixc-inmap-coverage.service';

@Module({
  imports: [MetricsCoreModule, IntegrationGovernanceModule, SupportCaseStateModule],
  controllers: [IxcController],
  providers: [IxcService, IxcHttpClient, IxcEvidenceCache, IdentityAttemptLimiter, IxcWriteExecutor, IxcInmapCoverageService],
  exports: [IxcService, IxcEvidenceCache, IxcWriteExecutor, IxcInmapCoverageService],
})
export class IxcModule {}
