import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { AiBudgetController } from './ai-budget.controller';
import { AiBudgetService } from './ai-budget.service';

@Module({ imports: [AuditModule], controllers: [AiBudgetController], providers: [AiBudgetService] })
export class AiBudgetModule {}
