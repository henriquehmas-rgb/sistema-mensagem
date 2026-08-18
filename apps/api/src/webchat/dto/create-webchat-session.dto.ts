import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** POST /api/webchat/session {orgSlug} (CONTRACTS §6). */
export class CreateWebchatSessionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  @Matches(/^[a-z0-9][a-z0-9-]*$/, { message: 'orgSlug em formato inválido' })
  orgSlug!: string;

  /** Nome opcional informado pelo visitante no widget. */
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name?: string;
}
