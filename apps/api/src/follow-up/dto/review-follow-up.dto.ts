import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewFollowUpDto {
  /** O avanço ocorre somente quando uma mensagem humana recebe status SENT. */
  @IsIn(['PAUSE', 'CANCEL'])
  decision!: 'PAUSE' | 'CANCEL';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
