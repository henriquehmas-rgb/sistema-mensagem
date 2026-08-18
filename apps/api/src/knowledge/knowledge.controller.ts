import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateKnowledgeSourceDto } from './dto/create-knowledge-source.dto';
import { KnowledgeService, type KnowledgeSourceDto } from './knowledge.service';

/** Base de conhecimento da IA — escrita restrita a ADMIN/SUPERVISOR. */
@Controller('knowledge')
export class KnowledgeController {
  constructor(private readonly knowledgeService: KnowledgeService) {}

  @Get()
  list(): Promise<KnowledgeSourceDto[]> {
    return this.knowledgeService.list();
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Post()
  create(@Body() dto: CreateKnowledgeSourceDto): Promise<KnowledgeSourceDto> {
    return this.knowledgeService.create(dto);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string): Promise<{ success: true }> {
    return this.knowledgeService.remove(id);
  }
}
