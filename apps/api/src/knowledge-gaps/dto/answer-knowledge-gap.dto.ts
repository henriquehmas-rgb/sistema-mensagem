import { IsString, MaxLength, MinLength } from 'class-validator';

export class AnswerKnowledgeGapDto {
  @IsString()
  @MinLength(2)
  @MaxLength(4_000)
  answer!: string;
}
