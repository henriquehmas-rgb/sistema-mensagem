import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class CreateGlobalDirectiveDto {
  @IsString() @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(80)
  key!: string;

  @IsString() @MinLength(3) @MaxLength(120)
  title!: string;

  @IsString() @MinLength(3) @MaxLength(60)
  category!: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000)
  priority?: number;

  @IsArray() @IsString({ each: true })
  principles!: string[];

  @IsArray() @IsString({ each: true })
  prohibitions!: string[];

  @IsString() @MinLength(2) @MaxLength(120)
  owner!: string;

  @IsOptional() @IsDateString()
  validUntil?: string;
}
