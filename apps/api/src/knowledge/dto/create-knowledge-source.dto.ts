import { SourceType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * POST /knowledge {type, name, contentText?|contentUrl?} (CONTRACTS §6).
 * TEXT/TABLE exigem contentText; PDF/URL exigem contentUrl (PDF por URL na Wave A).
 * A exigência cruzada é validada no service.
 */
export class CreateKnowledgeSourceDto {
  @IsEnum(SourceType)
  type!: SourceType;

  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500_000)
  contentText?: string;

  @IsOptional()
  @IsUrl({ require_protocol: true })
  @MaxLength(2048)
  contentUrl?: string;

  /** Autoridade editorial: 0 (auxiliar) a 100 (fonte oficial revisada). */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  authority?: number;

  @IsOptional()
  @IsDateString()
  validUntil?: string;
}
