import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { GlobalDirectivesController } from './global-directives.controller';
import { GlobalDirectivesService } from './global-directives.service';

@Module({
  imports: [AuditModule],
  controllers: [GlobalDirectivesController],
  providers: [GlobalDirectivesService],
})
export class GlobalDirectivesModule {}
