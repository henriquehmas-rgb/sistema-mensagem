import { IsBoolean, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

/**
 * A chave nunca é retornada pela API. `allowedHosts` é uma lista CSV de
 * hostnames; o host da URL precisa pertencer a ela para evitar SSRF acidental.
 */
export class ConfigureOlhoDeDeusDto {
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true, require_tld: false })
  @MaxLength(500)
  baseUrl!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2_000)
  allowedHosts!: string;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(1_000)
  apiKey?: string;

  /** Exceção temporária e auditada; `false` é o padrão seguro. */
  @IsBoolean()
  allowInsecureHttp!: boolean;

  @IsBoolean()
  isEnabled!: boolean;
}
