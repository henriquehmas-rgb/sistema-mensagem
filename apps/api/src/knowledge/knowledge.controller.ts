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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { CreateKnowledgeSourceDto } from './dto/create-knowledge-source.dto';
import {
  KnowledgeService,
  type KnowledgeSourceDto,
  type LearningCandidateDto,
  type LearningPatternDto,
} from './knowledge.service';
import { IxcSalesCatalogRefreshService, type IxcSalesCatalogRefreshResult } from './ixc-sales-catalog-refresh.service';

/** Base de conhecimento da IA — escrita restrita a ADMIN/SUPERVISOR. */
@Controller('knowledge')
export class KnowledgeController {
  constructor(
    private readonly knowledgeService: KnowledgeService,
    private readonly ixcSalesCatalog: IxcSalesCatalogRefreshService,
  ) {}

  @Get()
  list(): Promise<KnowledgeSourceDto[]> {
    return this.knowledgeService.list();
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Post()
  create(@Body() dto: CreateKnowledgeSourceDto): Promise<KnowledgeSourceDto> {
    return this.knowledgeService.create(dto);
  }

  /** Sincronização factual IXC→RAG, restrita a leitura e à administração. */
  @Roles('ADMIN', 'SUPERVISOR')
  @Post('catalog/ixc-sales/refresh')
  @HttpCode(HttpStatus.ACCEPTED)
  refreshIxcSalesCatalog(): Promise<IxcSalesCatalogRefreshResult> {
    return this.ixcSalesCatalog.refresh();
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Get('catalog/ixc-sales/status')
  ixcSalesCatalogStatus() {
    return this.ixcSalesCatalog.status();
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string): Promise<{ success: true }> {
    return this.knowledgeService.remove(id);
  }

  /** Reindexação explícita após troca do provedor/modelo de embeddings. */
  @Roles('ADMIN', 'SUPERVISOR')
  @Post(':id/reingest')
  @HttpCode(HttpStatus.ACCEPTED)
  reingest(@Param('id') id: string): Promise<KnowledgeSourceDto> {
    return this.knowledgeService.reingest(id);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Get('candidates/review')
  candidates(): Promise<LearningCandidateDto[]> {
    return this.knowledgeService.listCandidates();
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Get('patterns')
  patterns(): Promise<LearningPatternDto[]> {
    return this.knowledgeService.listPatterns();
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Post('candidates/:id/approve')
  @HttpCode(HttpStatus.OK)
  approveCandidate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<KnowledgeSourceDto> {
    return this.knowledgeService.approveCandidate(id, actor.userId);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Post('candidates/:id/reject')
  @HttpCode(HttpStatus.OK)
  rejectCandidate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<{ success: true }> {
    return this.knowledgeService.rejectCandidate(id, actor.userId);
  }
}
