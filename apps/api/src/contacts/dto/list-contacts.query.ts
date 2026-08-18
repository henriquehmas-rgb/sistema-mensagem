import { IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQuery } from '../../common/dto/pagination.query';

export class ListContactsQuery extends PaginationQuery {
  /** Busca em nome/phone/email (case-insensitive). */
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}
