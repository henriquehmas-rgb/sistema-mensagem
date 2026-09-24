import { SalesOpportunityStatus, SalesStageCategory } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { SalesService } from './sales.service';

const agent = { userId: 'agent_1', orgId: 'org_1', role: 'AGENT' } as const;
const supervisor = { userId: 'supervisor_1', orgId: 'org_1', role: 'SUPERVISOR' } as const;

function harness() {
  const opportunity = {
    id: 'opp_1', orgId: 'org_1', contactId: 'contact_1', conversationId: 'conversation_1',
    departmentId: 'sales_department', pipelineId: 'pipeline_1', stageId: 'won_stage',
    status: SalesOpportunityStatus.WON, closedReason: 'cliente aceitou', closedAt: new Date(), holdReason: null,
  };
  const tenant = {
    user: { findUnique: vi.fn().mockResolvedValue({ departmentId: 'sales_department' }) },
    salesPipeline: { findMany: vi.fn().mockResolvedValue([]) },
    salesStage: { findUnique: vi.fn() },
    salesOpportunity: {
      findUnique: vi.fn().mockResolvedValue(opportunity),
      update: vi.fn().mockResolvedValue(opportunity),
    },
    salesActivity: { create: vi.fn().mockResolvedValue({ id: 'activity_1' }) },
  };
  const prisma = { tenant };
  const tenancy = { getOrgIdOrThrow: vi.fn().mockReturnValue('org_1') };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  return { service: new SalesService(prisma as never, tenancy as never, audit as never), tenant };
}

describe('SalesService — isolamento e ciclo da oportunidade', () => {
  it('limita a lista de funis de um agente ao seu próprio setor', async () => {
    const h = harness();
    await h.service.listPipelines(agent as never);
    expect(h.tenant.salesPipeline.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true, departmentId: 'sales_department' },
    }));
  });

  it('mantém a visão organizacional para supervisor', async () => {
    const h = harness();
    await h.service.listPipelines(supervisor as never);
    expect(h.tenant.salesPipeline.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true },
    }));
  });

  it('limpa o encerramento anterior quando uma oportunidade é reaberta', async () => {
    const h = harness();
    h.tenant.salesStage.findUnique.mockResolvedValue({
      id: 'qualifying_stage', pipelineId: 'pipeline_1', category: SalesStageCategory.QUALIFYING,
    });
    await h.service.updateOpportunity('opp_1', { stageId: 'qualifying_stage' }, supervisor as never);
    expect(h.tenant.salesOpportunity.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: SalesOpportunityStatus.OPEN,
        closedReason: null,
        closedAt: null,
        holdReason: null,
      }),
    }));
  });
});
