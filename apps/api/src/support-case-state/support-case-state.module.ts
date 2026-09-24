import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SupportCaseStateService } from './support-case-state.service';

@Module({
  imports: [AuditModule],
  providers: [SupportCaseStateService],
  exports: [SupportCaseStateService],
})
export class SupportCaseStateModule {}
