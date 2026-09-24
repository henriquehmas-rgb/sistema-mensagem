import { IsString, Length } from 'class-validator';

export class IxcProtectedQuery {
  @IsString()
  @Length(1, 64)
  conversationId!: string;
}

