import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** POST /api/webchat/session {orgSlug} (CONTRACTS §6). */
export class CreateWebchatSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/, { message: 'orgSlug em formato inválido' })
  orgSlug!: string;

  /** Identifica o cliente no CRM desde o início do atendimento. */
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  /** Número em formato E.164, usado apenas para vincular o contato no CRM. */
  @IsString()
  @Matches(/^\+[1-9]\d{9,14}$/, { message: 'phone deve estar no formato internacional' })
  phone!: string;
}
