import { describe, expect, it } from 'vitest';
import { buildIxcServiceOrderInsert, buildIxcTicketInsert, type IxcWriteMapping } from './ixc-write-contract';

const mapping: IxcWriteMapping = {
  ticketSectorId: '7', serviceOrderSectorId: '3',
  ticketSubjectId: '60', serviceOrderSubjectId: '25',
  priority: 'N', initialTicketStatus: 'T', initialServiceOrderStatus: 'A',
  serviceOrderType: 'C', branchId: '1', origin: 'I',
};

describe('IXC write contract', () => {
  it('mantém cliente e contrato no payload preliminar do chamado', () => {
    expect(buildIxcTicketInsert({
      customerId: 'customer_test', contractId: 'contract_test',
      title: 'Falha individual de conexão', summary: 'Diagnóstico técnico resumido',
    }, mapping)).toMatchObject({
      id_cliente: 'customer_test', id_contrato: 'contract_test', id_ticket_setor: '7', id_assunto: '60',
    });
  });

  it('exige ticket para vincular a OS sem inventar contrato no recurso observado', () => {
    expect(() => buildIxcServiceOrderInsert({
      customerId: 'customer_test', ticketId: '', summary: 'Visita técnica necessária',
    }, mapping)).toThrow('IXC_WRITE_FIELD_REQUIRED:ticketId');
    expect(buildIxcServiceOrderInsert({
      customerId: 'customer_test', ticketId: 'ticket_1', summary: 'Visita técnica necessária',
    }, mapping)).toMatchObject({ id_cliente: 'customer_test', id_ticket: 'ticket_1', setor: '3', id_assunto: '25' });
  });
});
