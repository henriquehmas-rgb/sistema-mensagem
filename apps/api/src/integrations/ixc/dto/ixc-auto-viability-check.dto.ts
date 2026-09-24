import { IsLatitude, IsLongitude, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Consulta técnica nativa do InMap. Ela não usa campanha, canal nem cria uma
 * prospecção: recebe o endereço completo (resolvido a partir do CEP) ou,
 * quando necessário, as coordenadas compartilhadas pela pessoa.
 */
export class IxcAutoViabilityCheckDto {
  @IsString()
  @MinLength(1)
  conversationId!: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @Matches(/^\d{8}$/, { message: 'postalCode deve conter 8 dígitos, sem hífen' })
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  street?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  neighborhood?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  city?: string;

  @IsOptional()
  @Matches(/^[A-Z]{2}$/, { message: 'state deve ter duas letras maiúsculas' })
  state?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  number?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  complement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  reference?: string;
}
