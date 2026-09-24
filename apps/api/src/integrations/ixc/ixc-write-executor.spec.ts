import { describe, expect, it, vi } from 'vitest';
import { IxcWriteExecutor, normalizeIxcWriteOutcome } from './ixc-write-executor';

const command = {
  action: 'request_ticket' as const,
  mappingKey: 'support.connectivity.ticket',
  occurrenceId: 'occurrence-0001',
  idempotencyKey: 'a'.repeat(64),
  payload: { id_cliente: 'customer_1' },
};

describe('IxcWriteExecutor', () => {
  it('bloqueia antes de alcançar o transporte enquanto estiver em SHADOW', async () => {
    const transport = { execute: vi.fn() };
    await expect(new IxcWriteExecutor().execute(command, transport)).rejects.toThrow(
      'IXC_EXTERNAL_WRITE_DISABLED',
    );
    expect(transport.execute).not.toHaveBeenCalled();
  });

  it('trata resposta sem identificador como incerta', () => {
    expect(normalizeIxcWriteOutcome({ protocolo: 'P-1' })).toEqual({
      state: 'UNCERTAIN', ixcId: null, protocol: null, created: null,
    });
  });

  it('normaliza sucesso somente quando existe identificador', () => {
    expect(normalizeIxcWriteOutcome({ id: 123, protocolo: 'P-1' })).toEqual({
      state: 'COMPLETED', ixcId: '123', protocol: 'P-1', created: true,
    });
  });
});
