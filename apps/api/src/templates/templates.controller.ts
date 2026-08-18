import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { ListTemplatesQuery } from './dto/list-templates.query';
import { TemplatesService, type MessageTemplateResponseDto } from './templates.service';

/**
 * Templates de mensagem do WhatsApp (CONTRACTS §12):
 * `GET /channels/:id/templates?status=` (qualquer papel autenticado) e
 * `POST /channels/:id/templates/sync` (ADMIN|SUPERVISOR).
 */
@Controller('channels/:id/templates')
export class TemplatesController {
  constructor(private readonly templatesService: TemplatesService) {}

  @Get()
  list(
    @Param('id') channelId: string,
    @Query() query: ListTemplatesQuery,
  ): Promise<MessageTemplateResponseDto[]> {
    return this.templatesService.list(channelId, query.status);
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  sync(@Param('id') channelId: string): Promise<MessageTemplateResponseDto[]> {
    return this.templatesService.sync(channelId);
  }
}
