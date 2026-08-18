import { ChannelType, ConversationStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.query';

/** Sentinela para filtrar conversas sem responsável. */
export const UNASSIGNED = 'unassigned';

export class ListConversationsQuery extends PaginationQuery {
  @IsOptional()
  @IsEnum(ConversationStatus)
  status?: ConversationStatus;

  /** userId ou 'unassigned' (assigneeId nulo). */
  @IsOptional()
  @IsString()
  @MaxLength(64)
  assigneeId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  stageId?: string;

  /** CSV de tagIds — conversa com QUALQUER uma das tags. */
  @IsOptional()
  @IsString()
  @Matches(/^[\w-]+(,[\w-]+)*$/, { message: 'tagIds deve ser CSV de ids' })
  tagIds?: string;

  @IsOptional()
  @IsEnum(ChannelType)
  channelType?: ChannelType;

  /** Busca por nome do contato (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
