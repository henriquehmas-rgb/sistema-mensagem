import { Module } from '@nestjs/common';
import { IxcModule } from '../integrations/ixc/ixc.module';
import { AuditModule } from '../audit/audit.module';
import { OperationalActionsController } from './operational-actions.controller';
import { OperationalActionsService } from './operational-actions.service';

@Module({
  imports: [IxcModule, AuditModule],
  controllers: [OperationalActionsController],
  providers: [OperationalActionsService],
})
export class OperationalActionsModule {}
