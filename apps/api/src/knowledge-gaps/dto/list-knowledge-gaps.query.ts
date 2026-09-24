import { KnowledgeGapStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListKnowledgeGapsQuery {
  @IsOptional()
  @IsEnum(KnowledgeGapStatus)
  status?: KnowledgeGapStatus;
}
