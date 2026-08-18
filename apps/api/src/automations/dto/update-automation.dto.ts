import { PartialType } from '@nestjs/mapped-types';
import { CreateAutomationDto } from './create-automation.dto';

/** PATCH /automations/:id — todos os campos opcionais, mesmas validações. */
export class UpdateAutomationDto extends PartialType(CreateAutomationDto) {}
