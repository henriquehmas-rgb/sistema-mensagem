import { IsIn } from 'class-validator';

export class ChangeOperationalSkillStatusDto {
  @IsIn(['IN_REVIEW', 'APPROVED', 'ACTIVE', 'SUSPENDED'])
  status!: 'IN_REVIEW' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED';
}
