import { ConversationStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * PATCH /conversations/:id (CONTRACTS §6): assignee/status/stage/aiEnabled.
 * `null` explícito em assigneeId/stageId remove a atribuição/etapa
 * (@IsOptional aceita null — o service distingue undefined de null).
 */
export class UpdateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assigneeId?: string | null;

  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  stageId?: string | null;

  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  departmentId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  resolutionReasonId?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  resolutionNote?: string | null;
}
