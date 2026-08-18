import { TemplateStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

/** GET /channels/:id/templates?status= (CONTRACTS §12). */
export class ListTemplatesQuery {
  @IsOptional()
  @IsEnum(TemplateStatus)
  status?: TemplateStatus;
}
