import { IsLatitude, IsLongitude, IsString, Matches } from 'class-validator';

/**
 * Coordenadas já obtidas no fluxo oficial de endereço/viabilidade.
 * A API não aceita texto de endereço aqui para não introduzir geocodificação
 * informal nem registrar endereço bruto fora do fluxo próprio do CRM.
 */
export class IxcInmapCoverageDto {
  @IsString()
  @Matches(/^\d{1,20}$/, { message: 'cityId deve conter apenas números' })
  cityId!: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;
}
