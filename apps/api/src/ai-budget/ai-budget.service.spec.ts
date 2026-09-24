import { describe, expect, it, vi } from 'vitest';
import { AiBudgetService } from './ai-budget.service';

describe('AiBudgetService', () => {
  it('retorna crítico sem bloquear o atendimento', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ estimated_brl: '2500.00' }])
      .mockResolvedValueOnce([{ id: 'a1', threshold: 100, estimated_brl: '2500', budget_brl: '2500', recipient_email: 'leader@example.com', acknowledged_at: null, created_at: new Date('2026-09-03T00:00:00Z') }]);
    const service = new AiBudgetService(
      { prismaSystem: { $queryRaw: query } } as never,
      { getOrgIdOrThrow: () => 'org_1' } as never,
      { log: vi.fn() } as never,
      { get: () => 2500 } as never,
    );
    const status = await service.status();
    expect(status.level).toBe('CRITICAL');
    expect(status.blocksService).toBe(false);
    expect(status.reachedThreshold).toBe(100);
  });
});
