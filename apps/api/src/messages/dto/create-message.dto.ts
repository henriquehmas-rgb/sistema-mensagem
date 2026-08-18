import { MessageType } from '@prisma/client';
import { IsEnum, IsObject, NotEquals } from 'class-validator';

/**
 * POST /conversations/:id/messages {type, content} (CONTRACTS §6).
 * SYSTEM é gerado apenas pelo servidor. A coerência content×type
 * (text/mediaUrl/latitude...) é validada no service.
 */
export class CreateMessageDto {
  @IsEnum(MessageType)
  @NotEquals(MessageType.SYSTEM, { message: 'mensagens SYSTEM são geradas pelo servidor' })
  type!: MessageType;

  @IsObject()
  content!: Record<string, unknown>;
}
