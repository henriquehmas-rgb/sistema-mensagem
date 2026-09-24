import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateOperationalSkillDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(80)
  key!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  owner?: string;

  @IsOptional()
  @IsDateString()
  validUntil?: string;

  @IsOptional()
  @IsIn(['NONE', 'LAST_3_CPF', 'STRONG'])
  identityRequirement?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minimumConfidence?: number;

  @IsOptional() @IsArray() @IsString({ each: true }) triggerConditions?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) requiredData?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) allowedSources?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) protocolSteps?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) allowedActions?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) forbiddenActions?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) completionCriteria?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) reviewConditions?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) humanHandoffConditions?: string[];
}
