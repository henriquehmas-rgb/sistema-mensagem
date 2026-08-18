import { ArrayNotEmpty, ArrayUnique, IsArray, IsString } from 'class-validator';

/** POST /stages/reorder {ids} — ordem completa desejada das etapas. */
export class ReorderStagesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsString({ each: true })
  ids!: string[];
}
