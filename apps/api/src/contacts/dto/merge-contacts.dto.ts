import { IsNotEmpty, IsString } from 'class-validator';

export class MergeContactsDto {
  /** Contato duplicado cuja identidade e histórico devem migrar ao contato da rota. */
  @IsString()
  @IsNotEmpty()
  sourceContactId!: string;
}
