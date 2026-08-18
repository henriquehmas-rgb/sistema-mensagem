import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export class CreateTagDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  name!: string;

  @IsString()
  @Matches(HEX_COLOR, { message: 'color deve ser hex (#RGB ou #RRGGBB)' })
  color!: string;
}
