import { describe, expect, it } from 'vitest';
import { findEquivalentOperationalRecords } from './operational-duplicate-policy';

const ticket = (overrides: Record<string, unknown> = {}) => ({
  id: 'ticket_1', customerId: 'customer_1', contractId: 'contract_1', protocol: 'P-1',
  status: 'T', subjectId: 'subject_1', sectorId: '7', priority: 'N', pendingInteraction: false,
  openedAt: null, updatedAt: null, ...overrides,
});
const order = (overrides: Record<string, unknown> = {}) => ({
  id: 'order_1', customerId: 'customer_1', ticketId: 'ticket_1', protocol: 'OS-1',
  status: 'A', type: 'C', priority: 'N', sector: '3', subjectId: 'subject_1',
  openedAt: null, scheduledAt: null, closedAt: null, slaStatus: null, ...overrides,
});

describe('operational duplicate policy', () => {
  it('ignora registros abertos de outro assunto ou contrato quando os vínculos são completos', () => {
    const result = findEquivalentOperationalRecords(
      { action: 'request_ticket', contractId: 'contract_1', subjectId: 'subject_1' },
      [ticket({ subjectId: 'other_subject' }), ticket({ id: 'ticket_2', contractId: 'other_contract' })],
      [order({ subjectId: 'other_subject' })],
    );
    expect(result).toMatchObject({
      confirmedTickets: [], confirmedServiceOrders: [],
      possibleTickets: [], possibleServiceOrders: [], strategy: 'OCCURRENCE_AWARE',
    });
  });

  it('trata chamado semelhante como possível conflito, não como ocorrência idêntica', () => {
    const result = findEquivalentOperationalRecords(
      { action: 'request_ticket', contractId: 'contract_1', subjectId: 'subject_1' }, [ticket()], [],
    );
    expect(result.confirmedTickets).toEqual([]);
    expect(result.possibleTickets.map((item) => item.id)).toEqual(['ticket_1']);
  });

  it('só confirma a mesma OS quando o chamado de origem coincide', () => {
    const equivalent = findEquivalentOperationalRecords(
      {
        action: 'request_service_order', contractId: 'contract_1',
        subjectId: 'subject_1', sourceTicketId: 'ticket_1',
      },
      [ticket()], [order()],
    );
    expect(equivalent.confirmedTickets).toEqual([]);
    expect(equivalent.confirmedServiceOrders.map((item) => item.id)).toEqual(['order_1']);
    const otherContract = findEquivalentOperationalRecords(
      { action: 'request_service_order', contractId: 'other_contract', subjectId: 'subject_1' },
      [ticket()], [order()],
    );
    expect(otherContract.possibleServiceOrders).toEqual([]);
  });

  it('mantém bloqueio amplo quando o assunto não foi resolvido', () => {
    const result = findEquivalentOperationalRecords(
      { action: 'request_service_order', contractId: 'contract_1' }, [ticket()], [order()],
    );
    expect(result).toMatchObject({ strategy: 'CONSERVATIVE_MISSING_SUBJECT' });
    expect(result.confirmedTickets).toHaveLength(0);
    expect(result.possibleTickets).toHaveLength(1);
    expect(result.possibleServiceOrders).toHaveLength(1);
  });
});
