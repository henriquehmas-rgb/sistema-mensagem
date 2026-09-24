import { IsString, Matches, MaxLength } from 'class-validator';

export class IxcCustomerIdParams {
  @IsString()
  @MaxLength(20)
  @Matches(/^\d+$/, { message: 'customerId deve conter apenas números' })
  customerId!: string;
}
