import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaginationQuery } from '../common/dto/pagination.query';
import type { PaginatedDto } from '../common/serializers';
import {
  AutomationsService,
  type AutomationDto,
  type AutomationRunDto,
} from './automations.service';
import { CreateAutomationDto } from './dto/create-automation.dto';
import { UpdateAutomationDto } from './dto/update-automation.dto';

/** GET/POST/PATCH/DELETE /automations + GET /automations/:id/runs (CONTRACTS §6). */
@Controller('automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

  @Get()
  list(@Query() query: PaginationQuery): Promise<PaginatedDto<AutomationDto>> {
    return this.automationsService.list(query);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Post()
  create(@Body() dto: CreateAutomationDto): Promise<AutomationDto> {
    return this.automationsService.create(dto);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateAutomationDto): Promise<AutomationDto> {
    return this.automationsService.update(id, dto);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string): Promise<{ success: true }> {
    return this.automationsService.remove(id);
  }

  @Get(':id/runs')
  listRuns(
    @Param('id') id: string,
    @Query() query: PaginationQuery,
  ): Promise<PaginatedDto<AutomationRunDto>> {
    return this.automationsService.listRuns(id, query);
  }
}
