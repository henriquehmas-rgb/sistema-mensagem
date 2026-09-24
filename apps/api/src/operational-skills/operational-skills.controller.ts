import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ChangeOperationalSkillStatusDto } from './dto/change-operational-skill-status.dto';
import { CreateOperationalSkillDto } from './dto/create-operational-skill.dto';
import { OperationalSkillsService } from './operational-skills.service';
import { ListOperationalSkillsQueryDto } from './dto/list-operational-skills-query.dto';

@Controller('operational-skills')
export class OperationalSkillsController {
  constructor(private readonly service: OperationalSkillsService) {}

  @Get()
  @Roles('ADMIN', 'SUPERVISOR')
  list(@Query() query: ListOperationalSkillsQueryDto) {
    return this.service.list(query.status);
  }

  @Get(':id')
  @Roles('ADMIN', 'SUPERVISOR')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Roles('ADMIN')
  @Post()
  create(@Body() dto: CreateOperationalSkillDto) {
    return this.service.create(dto);
  }

  @Roles('ADMIN')
  @Post(':id/versions')
  createVersion(@Param('id') id: string, @Body() dto: CreateOperationalSkillDto) {
    return this.service.createVersion(id, dto);
  }

  @Roles('ADMIN')
  @Patch(':id/status')
  changeStatus(@Param('id') id: string, @Body() dto: ChangeOperationalSkillStatusDto) {
    return this.service.changeStatus(id, dto.status);
  }
}
