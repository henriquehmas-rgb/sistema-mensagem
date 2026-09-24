import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { NetworkTopologyMappingKind } from '@prisma/client';

/**
 * Cria somente um vínculo em sombra. A confirmação requer evidência separada
 * para impedir que uma inferência geográfica vire fato operacional.
 */
export class CreateNetworkTopologyMappingDto {
  @IsEnum(NetworkTopologyMappingKind)
  referenceKind!: NetworkTopologyMappingKind;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reference!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  olt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  board?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  pon?: string;
}

export class ConfirmNetworkTopologyMappingDto {
  /** Identificador da exportação, OS/instalação ou confirmação técnica. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  evidenceReference!: string;
}
