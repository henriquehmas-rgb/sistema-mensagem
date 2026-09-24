import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { IxcSalesCatalogRefreshService } from './ixc-sales-catalog-refresh.service';

const ORG_ID = 'org_seeg';

function harness(plans = [
  { id: '1', name: 'Plano 500 Mega', active: true, value: 99.9, loyaltyMonths: 12, productId: 'internal' },
  { id: '2', name: 'Plano 300 Mega', active: true, value: 79.9, loyaltyMonths: null, productId: null },
]) {
  const ixc = { listPlans: vi.fn().mockResolvedValue(plans) };
  const knowledgeSource = {
    findUnique: vi.fn().mockResolvedValue({ orgId: ORG_ID }),
    upsert: vi.fn().mockResolvedValue(undefined),
  };
  const prisma = { prismaSystem: { knowledgeSource } };
  const tenancy = { getOrgIdOrThrow: vi.fn().mockReturnValue(ORG_ID) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const queue = { add: vi.fn().mockResolvedValue(undefined) };
  const service = new IxcSalesCatalogRefreshService(
    ixc as never, prisma as never, tenancy as never, audit as never, queue as never,
  );
  return { service, ixc, knowledgeSource, audit, queue };
}

describe('IxcSalesCatalogRefreshService', () => {
  it('renova somente a partir da leitura IXC e agenda a reingestão', async () => {
    const h = harness();
    const result = await h.service.refresh();

    expect(result).toMatchObject({ sourceId: 'sales_ixc_catalog_candidate_v1', planCount: 2 });
    expect(h.knowledgeSource.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({ status: 'PENDING', meta: expect.objectContaining({
        factualSource: 'IXC', department: 'sales', automatedRefresh: true,
      }) }),
    }));
    const text = h.knowledgeSource.upsert.mock.calls[0]![0].update.meta.contentText;
    expect(text).toContain('Plano 300 Mega');
    expect(text).toContain('Cobertura no endereço');
    expect(text).not.toContain('internal');
    expect(h.queue.add).toHaveBeenCalledWith('ingest', expect.objectContaining({ orgId: ORG_ID }), expect.any(Object));
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'integration.ixc.catalog.sales.refresh' }));
  });

  it('preserva a fonte anterior quando o IXC não retorna planos ativos', async () => {
    const h = harness([]);
    await expect(h.service.refresh()).rejects.toThrow('IXC não retornou planos ativos');
    expect(h.knowledgeSource.upsert).not.toHaveBeenCalled();
    expect(h.queue.add).not.toHaveBeenCalled();
  });
});
