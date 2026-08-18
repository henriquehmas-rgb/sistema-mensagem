import { IsJWT, IsOptional } from 'class-validator';

export class LogoutDto {
  /** Se omitido, revoga TODOS os refresh tokens do usuário. */
  @IsOptional()
  @IsJWT()
  refreshToken?: string;
}
