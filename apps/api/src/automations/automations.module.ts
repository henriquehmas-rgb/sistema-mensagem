import { Module } from '@nestjs/common';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';

/**
 * Automações (CONTRACTS §6): CRUD + histórico de runs. O engine que consome a
 * fila `automation-run` vive no AutomationRunProcessor (queues/processors) e
 * compartilha o parsing de trigger/conditions/actions via automation.types.ts.
 */
@Module({
  controllers: [AutomationsController],
  providers: [AutomationsService],
})
export class AutomationsModule {}
