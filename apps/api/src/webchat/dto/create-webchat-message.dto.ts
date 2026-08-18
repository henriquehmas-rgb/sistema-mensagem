import { IsString, MaxLength, MinLength } from 'class-validator';

/** POST /api/webchat/messages — visitante envia apenas texto. */
export class CreateWebchatMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text!: string;
}
