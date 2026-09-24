import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class UpdateSalesOpportunityDto {
  @IsOptional() @IsString() @MaxLength(160)
  title?: string;

  @IsOptional() @IsString() @MaxLength(2_000)
  summary?: string | null;

  @IsOptional() @IsString() @MaxLength(64)
  stageId?: string;

  @IsOptional() @IsString() @MaxLength(64)
  assigneeId?: string | null;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000)
  estimatedValueCents?: number | null;

  @IsOptional() @IsString() @MaxLength(500)
  nextAction?: string | null;

  @IsOptional() @IsDateString()
  nextActionAt?: string | null;

  /** Obrigatório ao mover para WON, LOST ou ON_HOLD. */
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
