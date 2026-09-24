import { IsDateString, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSalesTaskDto {
  @IsString() @MinLength(3) @MaxLength(240)
  title!: string;

  @IsOptional() @IsString() @MaxLength(64)
  assigneeId?: string;

  @IsOptional() @IsDateString()
  dueAt?: string;
}
