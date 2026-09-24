import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class NormalizeNetworkEventDto {
  @IsString() @MaxLength(100)
  externalEventId!: string;

  @IsIn(['DOWN', 'RECOVERED'])
  status!: 'DOWN' | 'RECOVERED';

  @IsString() @MaxLength(120)
  olt!: string;

  @IsOptional() @IsString() @MaxLength(80)
  pon?: string;

  @IsOptional() @IsString() @MaxLength(80)
  route?: string;

  @IsOptional() @IsInt() @Min(0) @Max(100_000)
  affectedCustomers?: number;

  @IsOptional() @IsString() @MaxLength(80)
  source?: string;

  @IsOptional() @IsString() @MaxLength(40)
  occurredAt?: string;
}
