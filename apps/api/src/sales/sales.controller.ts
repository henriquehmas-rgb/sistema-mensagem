import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { CreateSalesOpportunityDto } from './dto/create-sales-opportunity.dto';
import { CreateSalesPipelineDto } from './dto/create-sales-pipeline.dto';
import { CreateSalesStageDto } from './dto/create-sales-stage.dto';
import { CreateSalesTaskDto } from './dto/create-sales-task.dto';
import { UpdateSalesOpportunityDto } from './dto/update-sales-opportunity.dto';
import { UpdateSalesTaskDto } from './dto/update-sales-task.dto';
import { SalesService } from './sales.service';

/** CRM comercial: registro e governança, nunca envio externo ou distribuição automática. */
@Controller('sales')
export class SalesController {
  constructor(private readonly sales: SalesService) {}

  @Get('pipelines') listPipelines(@CurrentUser() actor: AuthUser) { return this.sales.listPipelines(actor); }
  @Roles('ADMIN', 'SUPERVISOR') @Post('pipelines') createPipeline(@Body() dto: CreateSalesPipelineDto) { return this.sales.createPipeline(dto); }
  @Roles('ADMIN', 'SUPERVISOR') @Post('pipelines/:pipelineId/stages') createStage(@Param('pipelineId') pipelineId: string, @Body() dto: CreateSalesStageDto) { return this.sales.createStage(pipelineId, dto); }
  @Get('opportunities') list(@CurrentUser() actor: AuthUser) { return this.sales.listOpportunities(actor); }
  @Get('opportunities/:id') get(@Param('id') id: string, @CurrentUser() actor: AuthUser) { return this.sales.getOpportunity(id, actor); }
  @Post('opportunities') create(@Body() dto: CreateSalesOpportunityDto, @CurrentUser() actor: AuthUser) { return this.sales.createOpportunity(dto, actor); }
  @Patch('opportunities/:id') update(@Param('id') id: string, @Body() dto: UpdateSalesOpportunityDto, @CurrentUser() actor: AuthUser) { return this.sales.updateOpportunity(id, dto, actor); }
  @Post('opportunities/:id/tasks') createTask(@Param('id') id: string, @Body() dto: CreateSalesTaskDto, @CurrentUser() actor: AuthUser) { return this.sales.createTask(id, dto, actor); }
  @Patch('tasks/:id') updateTask(@Param('id') id: string, @Body() dto: UpdateSalesTaskDto, @CurrentUser() actor: AuthUser) { return this.sales.updateTask(id, dto, actor); }
  @Get('metrics') metrics(@CurrentUser() actor: AuthUser) { return this.sales.metrics(actor); }
}
