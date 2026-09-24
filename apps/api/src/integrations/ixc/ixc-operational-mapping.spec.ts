import { describe, expect, it } from 'vitest';
import {
  IXC_OPERATIONAL_MAPPING_DRAFTS,
  resolveActiveIxcMapping,
  resolveIxcMappingForSimulation,
} from './ixc-operational-mapping';

describe('IXC operational mapping', () => {
  it('não permite executar os candidatos ainda em rascunho', () => {
    expect(() => resolveActiveIxcMapping(
      IXC_OPERATIONAL_MAPPING_DRAFTS, 'support.connectivity.ticket',
    )).toThrow('IXC_MAPPING_NOT_ACTIVE');
  });

  it('permite resolver rascunho completo somente para simulação', () => {
    const resolved = resolveIxcMappingForSimulation(
      IXC_OPERATIONAL_MAPPING_DRAFTS,
      'support.connectivity.ticket',
      'request_ticket',
    );
    expect(resolved).toMatchObject({
      key: 'support.connectivity.ticket', status: 'DRAFT', action: 'request_ticket',
      mapping: { ticketSubjectId: '60', ticketSectorId: '7', initialTicketStatus: 'T' },
    });
  });

  it('recusa chave válida quando usada para outra ação', () => {
    expect(() => resolveIxcMappingForSimulation(
      IXC_OPERATIONAL_MAPPING_DRAFTS,
      'support.connectivity.ticket',
      'request_service_order',
    )).toThrow('IXC_MAPPING_NOT_FOUND');
  });

  it('recusa mapeamento ativo incompleto', () => {
    expect(() => resolveActiveIxcMapping([{
      key: 'support.test', version: 1, status: 'ACTIVE', action: 'request_ticket',
      mapping: { ticketSectorId: '7' }, evidence: [],
    }], 'support.test')).toThrow('IXC_MAPPING_INCOMPLETE');
  });

  it('resolve chamado completo sem exigir campos exclusivos de OS', () => {
    const resolved = resolveActiveIxcMapping([{
      key: 'support.ticket', version: 1, status: 'ACTIVE', action: 'request_ticket',
      mapping: {
        ticketSectorId: '7', ticketSubjectId: '60', priority: 'N',
        initialTicketStatus: 'T', branchId: '1', origin: 'I',
      }, evidence: [],
    }], 'support.ticket');

    expect(resolved.action).toBe('request_ticket');
    expect(resolved.mapping).toMatchObject({ ticketSubjectId: '60', initialTicketStatus: 'T' });
  });

  it('resolve OS completa sem exigir campos exclusivos de chamado', () => {
    const resolved = resolveActiveIxcMapping([{
      key: 'support.order', version: 1, status: 'ACTIVE', action: 'request_service_order',
      mapping: {
        serviceOrderSectorId: '3', serviceOrderSubjectId: '25', priority: 'C',
        initialServiceOrderStatus: 'A', serviceOrderType: 'C', branchId: '1', origin: 'I',
      }, evidence: [],
    }], 'support.order');

    expect(resolved.action).toBe('request_service_order');
    expect(resolved.mapping).toMatchObject({ serviceOrderSubjectId: '25', initialServiceOrderStatus: 'A' });
  });
});
