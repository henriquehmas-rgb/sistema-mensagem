import { Controller, Get, Param, Patch } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { AiBudgetService } from './ai-budget.service';

@Controller('ai-budget')
@Roles('ADMIN', 'SUPERVISOR')
export class AiBudgetController {
  constructor(private readonly service: AiBudgetService) {}

  @Get('status') status() { return this.service.status(); }

  @Patch('alerts/:id/acknowledge') acknowledge(@Param('id') id: string) {
    return this.service.acknowledge(id);
  }
}
