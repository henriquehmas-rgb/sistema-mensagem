import { Type } from 'class-transformer';
import { IsDateString, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateSalesOpportunityDto {
  @IsString() @MaxLength(64)
  contactId!: string;

  @IsString() @MaxLength(64)
  conversationId!: string;

  @IsString() @MaxLength(64)
  pipelineId!: string;

  @IsString() @MaxLength(64)
  stageId!: string;

  @IsString() @MinLength(3) @MaxLength(160)
  title!: string;

  @IsOptional() @IsString() @MaxLength(2_000)
  summary?: string;

  @IsOptional() @IsString() @MaxLength(64)
  assigneeId?: string;

  /** Valor em centavos; nunca é preço prometido nem condição enviada ao cliente. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100_000_000)
  estimatedValueCents?: number;

  @IsOptional() @IsString() @MaxLength(500)
  nextAction?: string;

  @IsOptional() @IsDateString()
  nextActionAt?: string;
}
