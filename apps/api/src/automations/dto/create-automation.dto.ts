import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * POST /automations (CONTRACTS §6). Formas internas de trigger/conditions/actions
 * (Json no schema) são validadas em profundidade no AutomationsService:
 * - trigger: { event: AutomationEvent }
 * - conditions: [{ field, op: eq|neq|contains|exists|not_exists, value? }]
 * - actions: [{ type: assign|add_tag|move_stage|set_status|disable_ai, ... }]
 */
export class CreateAutomationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsObject()
  trigger!: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  conditions?: unknown[];

  @IsArray()
  @ArrayMinSize(1)
  @Type(() => Object)
  actions!: unknown[];
}
