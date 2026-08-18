import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import type { MessageDto } from '../common/serializers';
import type { StoredUpload } from '../media/media.service';
import { createUploadMulterOptions } from '../media/multer-upload.options';
import { CreateWebchatMessageDto } from './dto/create-webchat-message.dto';
import { CreateWebchatSessionDto } from './dto/create-webchat-session.dto';
import { ListWebchatMessagesQuery } from './dto/list-webchat-messages.query';
import { WebchatService, type WebchatSessionDto } from './webchat.service';
import { WebchatUploadGuard } from './webchat-upload.guard';

/**
 * POST /session cria Contact+Conversation reais sem autenticação — throttle
 * bem mais restrito que o default para conter flood deliberado do inbox de
 * qualquer org (slug é público) com amplificação via automações (§9).
 */
const SESSION_THROTTLE = { default: { limit: 10, ttl: 60_000 } }; // CONTRACTS §9: webchat session 10/min

/**
 * POST /uploads (CONTRACTS §13, correção de revisão): sem override, herdaria
 * só o default global (120/min) — generoso demais para uma rota que aceita
 * multipart de até 20MB por request. Bem acima do necessário para um
 * visitante real anexar alguns arquivos, mas suficiente para limitar o custo
 * agregado de quem tem um visitorToken válido tentando forçar alocação de
 * memória repetida (o `WebchatUploadGuard` já barra quem NÃO tem um token
 * válido antes mesmo do multer rodar).
 */
const UPLOAD_THROTTLE = { default: { limit: 20, ttl: 60_000 } };

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
  @Throttle(SESSION_THROTTLE)
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

  /**
   * POST /api/webchat/uploads (CONTRACTS §13) — mesmo esquema de auth de
   * /messages e /session (Bearer visitorToken extraído manualmente; a
   * verificação de escopo acontece em WebchatService.verifyToken).
   * `WebchatUploadGuard` roda ANTES do `FileInterceptor` (Guards precedem
   * Interceptors no pipeline do Nest) — token inválido nunca chega a pagar o
   * custo do parse multipart/bufferização em memória (correção de revisão).
   */
  @Post('uploads')
  @UseGuards(WebchatUploadGuard)
  @Throttle(UPLOAD_THROTTLE)
  @UseInterceptors(FileInterceptor('file', createUploadMulterOptions()))
  @HttpCode(HttpStatus.CREATED)
  uploadFile(
    @Headers('authorization') authorization: string | undefined,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<StoredUpload> {
    return this.webchatService.uploadMedia(this.extractBearer(authorization), file);
  }

  private extractBearer(authorization: string | undefined): string {
    if (!authorization?.startsWith('Bearer ')) {
      return '';
    }
    return authorization.slice('Bearer '.length).trim();
  }
}
