import { SalesStageCategory } from '@prisma/client';
import { IsEnum, IsHexColor, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSalesStageDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name!: string;

  @IsEnum(SalesStageCategory)
  category!: SalesStageCategory;

  @IsOptional() @IsHexColor()
  color?: string;
}
