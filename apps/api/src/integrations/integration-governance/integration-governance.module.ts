import { Module } from '@nestjs/common';
import { IntegrationGovernanceService } from './integration-governance.service';

@Module({ providers: [IntegrationGovernanceService], exports: [IntegrationGovernanceService] })
export class IntegrationGovernanceModule {}
