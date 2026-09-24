import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class SearchIxcCustomerQuery {
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[0-9.\/-]+$/, { message: 'cpfCnpj contém caracteres inválidos' })
  cpfCnpj?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Matches(/^[0-9()+\s-]+$/, { message: 'phone contém caracteres inválidos' })
  phone?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d+$/, { message: 'id deve conter apenas números' })
  id?: string;
}
