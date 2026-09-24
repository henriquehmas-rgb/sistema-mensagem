import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Define uma pessoa-ponto-focal para a fila, sem assumir a conversa. */
export class ConfigureFollowUpOwnerDto {
  @IsOptional()
  @IsString()
  @MaxLength(128)
  responsibleUserId?: string | null;
}
