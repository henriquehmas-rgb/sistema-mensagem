import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChangeGlobalDirectiveStatusDto } from './dto/change-global-directive-status.dto';
import { CreateGlobalDirectiveDto } from './dto/create-global-directive.dto';
import { GlobalDirectivesService } from './global-directives.service';

@Controller('global-directives')
@Roles('ADMIN', 'SUPERVISOR')
export class GlobalDirectivesController {
  constructor(private readonly service: GlobalDirectivesService) {}

  @Get() list() { return this.service.list(); }

  @Roles('ADMIN')
  @Post() create(@Body() dto: CreateGlobalDirectiveDto) { return this.service.create(dto); }

  @Roles('ADMIN')
  @Post(':id/versions')
  createVersion(@Param('id') id: string, @Body() dto: CreateGlobalDirectiveDto) {
    return this.service.createVersion(id, dto);
  }

  @Roles('ADMIN')
  @Patch(':id/status')
  changeStatus(@Param('id') id: string, @Body() dto: ChangeGlobalDirectiveStatusDto) {
    return this.service.changeStatus(id, dto.status);
  }
}
