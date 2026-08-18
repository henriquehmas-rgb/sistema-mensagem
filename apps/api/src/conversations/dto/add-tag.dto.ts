import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  tagId!: string;
}
