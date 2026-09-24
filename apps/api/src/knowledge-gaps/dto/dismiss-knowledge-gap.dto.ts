import { IsString, MaxLength, MinLength } from 'class-validator';

/** Justificativa preservada no GAP e no audit log; nunca é enviada ao cliente. */
export class DismissKnowledgeGapDto {
  @IsString()
  @MinLength(8)
  @MaxLength(1000)
  note!: string;
}
