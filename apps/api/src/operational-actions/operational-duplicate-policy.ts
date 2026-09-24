import type { IxcServiceOrderDto, IxcTicketDto } from '../integrations/ixc/ixc.types';

const CLOSED = new Set(['F', 'C', 'FINALIZADO', 'ENCERRADO', 'CANCELADO']);

export interface DuplicateContext {
  action: 'request_ticket' | 'request_service_order';
  contractId: string;
  subjectId?: string;
  sourceTicketId?: string;
}

export interface EquivalentOperationalRecords {
  confirmedTickets: IxcTicketDto[];
  confirmedServiceOrders: IxcServiceOrderDto[];
  possibleTickets: IxcTicketDto[];
  possibleServiceOrders: IxcServiceOrderDto[];
  strategy: 'CONSERVATIVE_MISSING_SUBJECT' | 'OCCURRENCE_AWARE';
}

function open(status: string | null): boolean {
  return !CLOSED.has((status ?? '').toUpperCase());
}

function compatible(expected: string, actual: string | null | undefined): boolean {
  return actual == null || actual === '' || actual === expected;
}

export function findEquivalentOperationalRecords(
  context: DuplicateContext,
  tickets: IxcTicketDto[],
  serviceOrders: IxcServiceOrderDto[],
): EquivalentOperationalRecords {
  const openTickets = tickets.filter((item) => open(item.status));
  const openServiceOrders = serviceOrders.filter((item) => open(item.status));
  if (!context.subjectId) {
    return {
      confirmedTickets: [], confirmedServiceOrders: [],
      possibleTickets: openTickets, possibleServiceOrders: openServiceOrders,
      strategy: 'CONSERVATIVE_MISSING_SUBJECT',
    };
  }
  const equivalentTickets = openTickets.filter((item) => (
    compatible(context.contractId, item.contractId) && compatible(context.subjectId!, item.subjectId)
  ));
  const ticketsById = new Map(tickets.map((item) => [item.id, item]));
  const possibleOrders = openServiceOrders.filter((item) => {
    if (!compatible(context.subjectId!, item.subjectId)) return false;
    if (!item.ticketId) return true;
    const sourceTicket = ticketsById.get(item.ticketId);
    return !sourceTicket || compatible(context.contractId, sourceTicket.contractId);
  });
  const confirmedOrders = context.action === 'request_service_order' && context.sourceTicketId
    ? possibleOrders.filter((item) => item.ticketId === context.sourceTicketId)
    : [];
  const confirmedOrderIds = new Set(confirmedOrders.map((item) => item.id));
  return {
    // Registros antigos do mesmo assunto são semelhança, não identidade da ocorrência.
    confirmedTickets: [],
    confirmedServiceOrders: confirmedOrders,
    possibleTickets: context.action === 'request_ticket' ? equivalentTickets : [],
    possibleServiceOrders: possibleOrders.filter((item) => !confirmedOrderIds.has(item.id)),
    strategy: 'OCCURRENCE_AWARE',
  };
}
