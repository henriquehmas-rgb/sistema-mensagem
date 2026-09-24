import { Equals, IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Mesclagem é uma decisão humana: nunca inferimos que duas identidades são da
 * mesma pessoa por nome, mensagem ou semelhança de perfil.
 */
export class MergeContactDto {
  @IsString()
  @IsNotEmpty()
  sourceContactId!: string;

  @IsBoolean()
  @Equals(true, { message: 'confirmação explícita é obrigatória para mesclar contatos' })
  confirm!: boolean;

  /** Motivo curto de auditoria; não use dados sensíveis. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
