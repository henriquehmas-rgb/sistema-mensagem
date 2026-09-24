import {
  IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength, Min,
} from 'class-validator';

export class SimulateNetworkContextDto {
  @IsString() @MaxLength(80)
  customerReference!: string;

  @IsOptional() @IsString() @MaxLength(120)
  olt?: string;

  @IsOptional() @IsString() @MaxLength(80)
  pon?: string;

  @IsOptional() @IsString() @MaxLength(80)
  cto?: string;

  @IsOptional() @IsString() @MaxLength(80)
  route?: string;

  @IsIn(['ONLINE', 'OFFLINE', 'UNKNOWN'])
  onuState!: 'ONLINE' | 'OFFLINE' | 'UNKNOWN';

  @IsOptional() @IsNumber() @Min(-60) @Max(10)
  opticalSignalDbm?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100_000)
  affectedOnus?: number;

  @IsOptional() @IsInt() @Min(0) @Max(100_000)
  totalOnus?: number;

  @IsOptional() @IsBoolean()
  ixcAlert?: boolean;

  @IsIn(['NONE', 'SUSPECTED', 'CONFIRMED', 'RECOVERED'])
  eventState!: 'NONE' | 'SUSPECTED' | 'CONFIRMED' | 'RECOVERED';

  @IsIn(['AVAILABLE', 'UNAVAILABLE', 'STALE'])
  oltSourceState!: 'AVAILABLE' | 'UNAVAILABLE' | 'STALE';

  @IsIn(['AVAILABLE', 'UNAVAILABLE', 'STALE'])
  ixcSourceState!: 'AVAILABLE' | 'UNAVAILABLE' | 'STALE';

  @IsISO8601()
  observedAt!: string;
}
