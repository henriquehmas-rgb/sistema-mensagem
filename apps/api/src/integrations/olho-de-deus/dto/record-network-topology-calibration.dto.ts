import { IsEnum, IsISO8601, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { NetworkTopologyMappingKind } from '@prisma/client';

/**
 * Uma calibração é uma ocorrência já confirmada fora do Omni. Os valores
 * enviados servem só para gerar HMAC; o banco não armazena referência de
 * cliente, caixa ou evento em texto claro.
 */
export class RecordNetworkTopologyCalibrationDto {
  @IsEnum(NetworkTopologyMappingKind)
  referenceKind!: NetworkTopologyMappingKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reference!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  olt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  board?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  pon?: string;

  /** Identificador técnico do evento do Olho de Deus; armazenado somente como HMAC. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  externalEventId!: string;

  /** Referência de relatório técnico/ocorrência confirmada; armazenada somente como HMAC. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  evidenceReference!: string;

  @IsISO8601()
  observedAt!: string;
}
