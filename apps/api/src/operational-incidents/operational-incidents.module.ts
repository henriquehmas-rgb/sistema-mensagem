import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OperationalIncidentsController } from './operational-incidents.controller';
import { OperationalIncidentsService } from './operational-incidents.service';
import { TeamsOperationsNotifier } from './teams-operations-notifier.service';

@Module({
  imports: [AuditModule],
  controllers: [OperationalIncidentsController],
  providers: [OperationalIncidentsService, TeamsOperationsNotifier],
  exports: [OperationalIncidentsService],
})
export class OperationalIncidentsModule {}
