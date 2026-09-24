import { IsIn } from 'class-validator';

export class ChangeGlobalDirectiveStatusDto {
  @IsIn(['IN_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED'])
  status!: 'IN_REVIEW' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED';
}
