import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const DEFAULT_WEBCHAT_PAGE = 50;

/** GET /api/webchat/messages?after= — polling incremental (after = id da última msg vista). */
export class ListWebchatMessagesQuery {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  after?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = DEFAULT_WEBCHAT_PAGE;
}
