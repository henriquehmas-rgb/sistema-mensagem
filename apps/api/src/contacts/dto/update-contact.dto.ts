import { PartialType } from '@nestjs/mapped-types';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateContactDto } from './create-contact.dto';

export class UpdateContactDto extends PartialType(CreateContactDto) {
  /**
   * CONTRACTS §15: memória de longo prazo por contato. Escrita normal vem do
   * processor `memory-summarize` (via prismaSystem, fora deste DTO); aqui só
   * cobre a limpeza manual pela UI ("Limpar memória" em crm-panel.tsx envia
   * `null` explícito). `@IsOptional()` já trata `null` como valor válido —
   * ausente (undefined) não mexe no campo.
   */
  @IsOptional()
  @IsString()
  // Mesmo cap do resumo gerado pela IA (services/ai/src/config.py::memory_summary_max_chars) —
  // uma edição manual não deveria produzir texto maior do que o próprio pipeline geraria.
  @MaxLength(1500)
  memorySummary?: string | null;
}
