import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class ConfigureIxcDto {
  @IsUrl({ protocols: ['https'], require_protocol: true, require_tld: false })
  @MaxLength(500)
  baseUrl!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  username!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  token?: string;

  @IsBoolean()
  isEnabled!: boolean;
}
