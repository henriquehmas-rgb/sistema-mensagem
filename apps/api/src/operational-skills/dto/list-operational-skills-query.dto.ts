import { OperationalSkillStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListOperationalSkillsQueryDto {
  @IsOptional()
  @IsEnum(OperationalSkillStatus)
  status?: OperationalSkillStatus;
}
