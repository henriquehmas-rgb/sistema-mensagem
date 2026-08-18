import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const DEFAULT_MESSAGE_PAGE = 30;

/**
 * GET /conversations/:id/messages?cursor=&limit= — paginação por cursor,
 * mais recentes primeiro. cursor = id da mensagem mais antiga já carregada.
 */
export class ListMessagesQuery {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = DEFAULT_MESSAGE_PAGE;
}
