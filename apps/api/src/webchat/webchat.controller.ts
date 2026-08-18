import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Public } from '../auth/decorators/public.decorator';
import type { MessageDto } from '../common/serializers';
import { CreateWebchatMessageDto } from './dto/create-webchat-message.dto';
import { CreateWebchatSessionDto } from './dto/create-webchat-session.dto';
import { ListWebchatMessagesQuery } from './dto/list-webchat-messages.query';
import { WebchatService, type WebchatSessionDto } from './webchat.service';

/**
 * Webchat público (CONTRACTS §6) — VERSION_NEUTRAL (/api/webchat/**), sem JWT
 * de agente: autenticação via visitorToken (Bearer). Rate limit default (120/min)
 * continua valendo — só webhooks/health são isentos (§9).
 */
@Public()
@Controller({ path: 'webchat', version: VERSION_NEUTRAL })
export class WebchatController {
  constructor(private readonly webchatService: WebchatService) {}

  @Post('session')
  @HttpCode(HttpStatus.OK)
  createSession(@Body() dto: CreateWebchatSessionDto): Promise<WebchatSessionDto> {
    return this.webchatService.createSession(dto);
  }

  @Post('messages')
  @HttpCode(HttpStatus.CREATED)
  sendMessage(
    @Headers('authorization') authorization: string | undefined,
    @Body() dto: CreateWebchatMessageDto,
  ): Promise<{ message: MessageDto }> {
    return this.webchatService.sendMessage(this.extractBearer(authorization), dto);
  }

  @Get('messages')
  listMessages(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: ListWebchatMessagesQuery,
  ): Promise<{ data: MessageDto[] }> {
    return this.webchatService.listMessages(this.extractBearer(authorization), query);
  }

  private extractBearer(authorization: string | undefined): string {
    if (!authorization?.startsWith('Bearer ')) {
      return '';
    }
    return authorization.slice('Bearer '.length).trim();
  }
}
