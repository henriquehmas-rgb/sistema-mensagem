import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateReadinessSnapshotDto {
  /** Rótulo humano opcional, por exemplo "antes do piloto WhatsApp". */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  label?: string;
}
