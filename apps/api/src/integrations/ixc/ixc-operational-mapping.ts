import type {
  IxcServiceOrderWriteMapping,
  IxcTicketWriteMapping,
  IxcWriteMapping,
} from './ixc-write-contract';

export interface IxcOperationalMappingDefinition {
  key: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'SUSPENDED' | 'REPLACED';
  action: 'request_ticket' | 'request_service_order';
  mapping: Partial<IxcWriteMapping>;
  evidence: string[];
}

/**
 * Candidatos obtidos do catálogo real da SEEG. Permanecem inativos até revisão;
 * IDs externos nunca são escolhidos ou alterados pelo modelo de IA.
 */
export const IXC_OPERATIONAL_MAPPING_DRAFTS: readonly IxcOperationalMappingDefinition[] = [
  {
    key: 'support.connectivity.ticket', version: 1, status: 'DRAFT', action: 'request_ticket',
    mapping: {
      ticketSectorId: '7', ticketSubjectId: '60', priority: 'N',
      initialTicketStatus: 'T', branchId: '1', origin: 'I',
    },
    evidence: [
      'IXC su_ticket_setor:7 Atendimento ativo',
      'IXC su_oss_assunto:60 Registro - Suporte Técnico',
      'Amostra read-only: filial 1 em 100/100 chamados do assunto 60',
      'Estado T encontrado entre chamados ainda em andamento; candidato sujeito à homologação',
    ],
  },
  {
    key: 'support.fiber_los.service_order', version: 1, status: 'DRAFT', action: 'request_service_order',
    mapping: {
      serviceOrderSectorId: '3', serviceOrderSubjectId: '25', priority: 'C',
      initialServiceOrderStatus: 'A', serviceOrderType: 'C', branchId: '1', origin: 'I',
    },
    evidence: [
      'IXC su_ticket_setor:3 Técnico ativo',
      'IXC su_oss_assunto:25 Manutenção - Fibra (LOS)',
      'Amostra read-only: filial 1 e tipo C em 100/100 OS do assunto 25',
      'Estado A encontrado em OS aberta; candidato sujeito à homologação',
    ],
  },
  {
    key: 'support.signal_correction.service_order', version: 1, status: 'DRAFT', action: 'request_service_order',
    mapping: {
      serviceOrderSectorId: '3', serviceOrderSubjectId: '28', priority: 'N',
      initialServiceOrderStatus: 'A', serviceOrderType: 'C', branchId: '1', origin: 'I',
    },
    evidence: [
      'IXC su_ticket_setor:3 Técnico ativo',
      'IXC su_oss_assunto:28 Manutenção - Correção de Sinal',
      'Amostra read-only: filial 1 e tipo C em 100/100 OS do assunto 28',
      'Estado A encontrado em OS aberta; candidato sujeito à homologação',
    ],
  },
] as const;

const REQUIRED_BY_ACTION = {
  request_ticket: [
    'ticketSectorId', 'ticketSubjectId', 'priority', 'initialTicketStatus', 'branchId', 'origin',
  ],
  request_service_order: [
    'serviceOrderSectorId', 'serviceOrderSubjectId', 'priority', 'initialServiceOrderStatus',
    'serviceOrderType', 'branchId', 'origin',
  ],
} as const satisfies Record<IxcOperationalMappingDefinition['action'], readonly (keyof IxcWriteMapping)[]>;

export type ResolvedIxcOperationalMapping =
  | { key: string; version: number; status: 'DRAFT' | 'ACTIVE'; action: 'request_ticket'; mapping: IxcTicketWriteMapping }
  | { key: string; version: number; status: 'DRAFT' | 'ACTIVE'; action: 'request_service_order'; mapping: IxcServiceOrderWriteMapping };

function resolveCompleteMapping(
  definition: IxcOperationalMappingDefinition,
): ResolvedIxcOperationalMapping {
  const missing = REQUIRED_BY_ACTION[definition.action].filter((field) => !definition.mapping[field]);
  if (missing.length) throw new Error(`IXC_MAPPING_INCOMPLETE:${missing.join(',')}`);
  if (definition.status !== 'DRAFT' && definition.status !== 'ACTIVE') {
    throw new Error('IXC_MAPPING_NOT_AVAILABLE');
  }
  const metadata = { key: definition.key, version: definition.version, status: definition.status };
  if (definition.action === 'request_ticket') {
    return { ...metadata, action: definition.action, mapping: definition.mapping as IxcTicketWriteMapping };
  }
  return { ...metadata, action: definition.action, mapping: definition.mapping as IxcServiceOrderWriteMapping };
}

export function resolveActiveIxcMapping(
  definitions: readonly IxcOperationalMappingDefinition[],
  key: string,
): ResolvedIxcOperationalMapping {
  const active = definitions.filter((item) => item.key === key && item.status === 'ACTIVE');
  if (active.length !== 1) throw new Error(active.length ? 'IXC_MAPPING_AMBIGUOUS' : 'IXC_MAPPING_NOT_ACTIVE');
  return resolveCompleteMapping(active[0]!);
}

/** Rascunhos completos podem ser exercitados somente pelo simulador SHADOW. */
export function resolveIxcMappingForSimulation(
  definitions: readonly IxcOperationalMappingDefinition[],
  key: string,
  action: IxcOperationalMappingDefinition['action'],
): ResolvedIxcOperationalMapping {
  const candidates = definitions.filter((item) => item.key === key && item.action === action);
  if (candidates.length !== 1) {
    throw new Error(candidates.length ? 'IXC_MAPPING_AMBIGUOUS' : 'IXC_MAPPING_NOT_FOUND');
  }
  return resolveCompleteMapping(candidates[0]!);
}
