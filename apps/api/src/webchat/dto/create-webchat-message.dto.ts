import { MessageType } from '@prisma/client';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Tipos de mensagem que um VISITANTE pode enviar (CONTRACTS §13): texto ou
 * mídia (upload próprio via POST /webchat/uploads). STICKER/LOCATION/TEMPLATE/
 * SYSTEM continuam fora do alcance do visitante.
 */
export const WEBCHAT_VISITOR_MESSAGE_TYPES = [
  MessageType.TEXT,
  MessageType.IMAGE,
  MessageType.AUDIO,
  MessageType.VIDEO,
  MessageType.DOCUMENT,
] as const;

/**
 * POST /api/webchat/messages — visitante envia texto (`type` omitido/TEXT)
 * ou mídia (`type` = IMAGE/AUDIO/VIDEO/DOCUMENT + mediaUrl/mimeType do
 * próprio upload). Coerência content×type é validada no service — mesmo
 * espírito de `messages/dto/create-message.dto.ts`, mas com um subconjunto de
 * tipos e sem aceitar `content` livre (a API pública não deve virar um jeito
 * de gravar Json arbitrário).
 */
export class CreateWebchatMessageDto {
  @IsOptional()
  @IsIn(WEBCHAT_VISITOR_MESSAGE_TYPES)
  type: MessageType = MessageType.TEXT;

  /** Texto da mensagem (type=TEXT) ou legenda opcional (type de mídia). */
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  text?: string;

  /** Obrigatório para type de mídia — DEVE ser a URL retornada por POST /webchat/uploads. */
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  mediaUrl?: string;

  /** Obrigatório para type de mídia. */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  mimeType?: string;

  /** Nome de exibição opcional (documentos). */
  @IsOptional()
  @IsString()
  @MaxLength(255)
  filename?: string;
}
