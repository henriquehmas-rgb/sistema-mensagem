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
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import type { PipelineStageDto } from '../common/serializers';
import { CreateStageDto } from './dto/create-stage.dto';
import { ReorderStagesDto } from './dto/reorder-stages.dto';
import { UpdateStageDto } from './dto/update-stage.dto';
import { StagesService } from './stages.service';

/** Leitura para todos; escrita restrita a ADMIN/SUPERVISOR. */
@Controller('stages')
export class StagesController {
  constructor(private readonly stagesService: StagesService) {}

  @Get()
  list(): Promise<PipelineStageDto[]> {
    return this.stagesService.list();
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Post()
  create(@Body() dto: CreateStageDto): Promise<PipelineStageDto> {
    return this.stagesService.create(dto);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Post('reorder')
  @HttpCode(HttpStatus.OK)
  reorder(@Body() dto: ReorderStagesDto): Promise<PipelineStageDto[]> {
    return this.stagesService.reorder(dto);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateStageDto): Promise<PipelineStageDto> {
    return this.stagesService.update(id, dto);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string): Promise<{ success: true }> {
    return this.stagesService.remove(id);
  }
}
