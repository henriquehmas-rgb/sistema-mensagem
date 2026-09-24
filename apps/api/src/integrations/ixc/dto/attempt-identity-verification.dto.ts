import { Matches } from 'class-validator';

export class AttemptIdentityVerificationDto {
  @Matches(/^\d{11}$/, { message: 'cpf deve conter exatamente 11 dígitos' })
  cpf!: string;
}
