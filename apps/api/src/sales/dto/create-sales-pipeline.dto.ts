import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSalesPipelineDto {
  @IsString() @MinLength(2) @MaxLength(80)
  name!: string;

  /** Departamento comercial já existente; não cria usuários nem distribuição. */
  @IsOptional() @IsString() @MaxLength(64)
  departmentId?: string;
}
