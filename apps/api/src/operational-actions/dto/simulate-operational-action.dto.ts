import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class SimulateOperationalActionDto {
  @IsIn(['request_ticket', 'request_service_order'])
  action!: 'request_ticket' | 'request_service_order';

  @IsString() @MinLength(1) @MaxLength(64)
  skillId!: string;

  @IsString() @MinLength(1) @MaxLength(64)
  conversationId!: string;

  @IsString() @MinLength(1) @MaxLength(64)
  customerId!: string;

  @IsString() @MinLength(1) @MaxLength(64)
  contractId!: string;

  @IsString() @MinLength(2) @MaxLength(80)
  intent!: string;

  /** Chave controlada pelo Omni; IDs IXC nunca são recebidos do modelo ou do cliente. */
  @IsString() @MinLength(3) @MaxLength(80)
  mappingKey!: string;

  @IsOptional() @IsString() @MaxLength(64)
  sourceTicketId?: string;

  /** Identificador criado pelo Omni para uma ocorrência nova, distinto do assunto. */
  @IsOptional() @IsString() @MinLength(8) @MaxLength(64)
  occurrenceId?: string;

  /** EventID técnico externo, quando o Olho de Deus fornecer essa correlação. */
  @IsOptional() @IsString() @MinLength(1) @MaxLength(64)
  networkEventId?: string;

  @IsOptional()
  @IsIn([
    'NORMAL', 'INDIVIDUAL_FAILURE', 'COLLECTIVE_OUTAGE_SUSPECTED',
    'COLLECTIVE_OUTAGE_CONFIRMED', 'IXC_FALSE_POSITIVE_SUSPECTED',
    'RECOVERED', 'INCONCLUSIVE',
  ])
  networkDiagnosis?:
    | 'NORMAL'
    | 'INDIVIDUAL_FAILURE'
    | 'COLLECTIVE_OUTAGE_SUSPECTED'
    | 'COLLECTIVE_OUTAGE_CONFIRMED'
    | 'IXC_FALSE_POSITIVE_SUSPECTED'
    | 'RECOVERED'
    | 'INCONCLUSIVE';
}
