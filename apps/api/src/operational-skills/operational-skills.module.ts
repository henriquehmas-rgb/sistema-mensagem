import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OperationalSkillsController } from './operational-skills.controller';
import { OperationalSkillsService } from './operational-skills.service';

@Module({
  imports: [AuditModule],
  controllers: [OperationalSkillsController],
  providers: [OperationalSkillsService],
  exports: [OperationalSkillsService],
})
export class OperationalSkillsModule {}
