import { describe, expect, it, vi } from 'vitest';
import { IxcEvidenceCache } from './ixc-evidence-cache';

function harness() {
  const store = new Map<string, string>();
  const client = {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => { store.set(key, value); return 'OK'; }),
    del: vi.fn(async (...keys: string[]) => {
      for (const key of keys) store.delete(key);
      return keys.length;
    }),
  };
  return { cache: new IxcEvidenceCache({ client } as never), client, store };
}

describe('IxcEvidenceCache', () => {
  it('mantém evidências separadas por conversa e recurso com TTL específico', async () => {
    const h = harness();
    await h.cache.write('org1', 'conv1', ['connections', 'contracts'], {
      source: 'IXC', status: 'success', observedAt: '2026-08-22T17:00:00Z',
      facts: [
        { resource: 'connections', entityRef: 'c1', fields: { online: true } },
        { resource: 'contracts', entityRef: 'p1', fields: { status: 'A' } },
      ],
    });
    expect(h.client.set).toHaveBeenCalledWith(expect.stringContaining(':connections'), expect.any(String), 'EX', 30);
    expect(h.client.set).toHaveBeenCalledWith(expect.stringContaining(':contracts'), expect.any(String), 'EX', 300);
    const result = await h.cache.read('org1', 'conv1', ['connections', 'contracts']);
    expect(result.missing).toEqual([]);
    expect(result.evidence?.facts).toHaveLength(2);
  });

  it('considera apenas recursos ausentes como pendentes', async () => {
    const h = harness();
    await h.cache.write('org1', 'conv1', ['invoices'], {
      source: 'IXC', status: 'empty', observedAt: '2026-08-22T17:00:00Z', facts: [],
    });
    const result = await h.cache.read('org1', 'conv1', ['invoices', 'service_orders']);
    expect(result.missing).toEqual(['service_orders']);
    expect(result.evidence?.status).toBe('empty');
  });

  it('limpa todos os recursos da conversa ao trocar o titular em qualquer setor', async () => {
    const h = harness();
    await h.cache.write('org1', 'conv1', ['connections', 'contracts'], {
      source: 'IXC', status: 'success', observedAt: '2026-09-23T10:00:00Z',
      facts: [{ resource: 'contracts', entityRef: 'old', fields: { status: 'A' } }],
    });
    await h.cache.clear('org1', 'conv1');
    const result = await h.cache.read('org1', 'conv1', ['connections', 'contracts']);
    expect(result.evidence).toBeNull();
    expect(result.missing).toEqual(['connections', 'contracts']);
  });

  it('falha aberta quando o Redis está indisponível', async () => {
    const h = harness();
    h.client.get.mockRejectedValue(new Error('offline'));
    await expect(h.cache.read('org1', 'conv1', ['connections'])).resolves.toMatchObject({
      evidence: null, missing: ['connections'],
    });
  });
});
