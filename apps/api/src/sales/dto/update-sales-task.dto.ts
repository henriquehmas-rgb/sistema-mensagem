import { SalesTaskStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateSalesTaskDto {
  @IsOptional() @IsString() @MaxLength(240)
  title?: string;

  @IsOptional() @IsString() @MaxLength(64)
  assigneeId?: string | null;

  @IsOptional() @IsEnum(SalesTaskStatus)
  status?: SalesTaskStatus;
}
