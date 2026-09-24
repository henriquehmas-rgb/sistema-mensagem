import { IsIn } from 'class-validator';

export class VerifyIdentityDto {
  @IsIn(['IN_PERSON_CONFIRMED'])
  method!: 'IN_PERSON_CONFIRMED';
}
