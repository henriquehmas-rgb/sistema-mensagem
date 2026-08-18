import { IsNumber, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * POST /conversations/:id/move (kanban). stagePosition é a posição float
 * desejada (tipicamente a média entre os vizinhos calculada pelo cliente);
 * o server rebalanceia a coluna em caso de colisão.
 */
export class MoveConversationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  stageId!: string;

  @IsNumber({ allowNaN: false, allowInfinity: false })
  stagePosition!: number;
}
