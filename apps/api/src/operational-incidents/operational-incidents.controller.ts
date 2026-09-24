import { Controller, Get, Param, Patch } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { OperationalIncidentsService } from './operational-incidents.service';

@Controller('operational-incidents')
@Roles('ADMIN', 'SUPERVISOR')
export class OperationalIncidentsController {
  constructor(private readonly incidents: OperationalIncidentsService) {}

  @Get()
  list() {
    return this.incidents.list();
  }

  @Patch(':id/acknowledge')
  acknowledge(@Param('id') id: string) {
    return this.incidents.acknowledge(id);
  }

  @Patch(':id/resolve')
  resolve(@Param('id') id: string) {
    return this.incidents.resolve(id);
  }
}
