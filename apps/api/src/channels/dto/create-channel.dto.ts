import { ChannelType } from '@prisma/client';
import { IsEnum, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /channels (CONTRACTS §6) — credenciais só na criação/edição, NUNCA retornadas.
 * `credentials` é um mapa chave→valor (ex.: accessToken, phoneNumberId) cifrado
 * com AES-256-GCM antes de persistir (CONTRACTS §9).
 */
export class CreateChannelDto {
  @IsEnum(ChannelType)
  type!: ChannelType;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, unknown>;

  /** phone_number_id (WhatsApp) / IG business id — usado para rotear webhooks. */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  externalId?: string;
}
