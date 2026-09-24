import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { KnowledgeGapStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { KnowledgeGapsService } from './knowledge-gaps.service';

function harness() {
  const gap = {
    id: 'gap_1', orgId: 'org_1', conversationId: 'conv_1', departmentId: 'dep_1',
    status: KnowledgeGapStatus.PENDING, reason: 'sem_contexto', question: 'Como resolver?',
  };
  const tenantGap = {
    findMany: vi.fn().mockResolvedValue([]),
    findFirst: vi.fn().mockResolvedValue(gap),
    update: vi.fn().mockResolvedValue({ ...gap, status: KnowledgeGapStatus.DISMISSED }),
  };
  const systemGap = {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue(gap),
  };
  const tx = {
    knowledgeGap: { update: vi.fn().mockResolvedValue({ ...gap, status: KnowledgeGapStatus.ANSWERED }) },
    message: { create: vi.fn().mockResolvedValue({ id: 'msg_internal_1' }) },
  };
  const prisma = {
    tenant: {
      knowledgeGap: tenantGap,
      user: { findFirst: vi.fn().mockResolvedValue({ departmentId: 'dep_1' }) },
    },
    prismaSystem: {
      knowledgeGap: systemGap,
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
  const tenancy = { getOrgIdOrThrow: vi.fn().mockReturnValue('org_1') };
  const audit = { log: vi.fn().mockResolvedValue(undefined), logSystem: vi.fn().mockResolvedValue(undefined) };
  const queue = { add: vi.fn().mockResolvedValue(undefined) };
  const service = new KnowledgeGapsService(prisma as never, tenancy as never, audit as never, queue as never);
  return { service, gap, tenantGap, systemGap, tx, audit, queue };
}

describe('KnowledgeGapsService', () => {
  const supervisor = { userId: 'supervisor_1', orgId: 'org_1', role: 'SUPERVISOR' } as const;
  const agent = { userId: 'agent_1', orgId: 'org_1', role: 'AGENT' } as const;

  it('deduplica dúvidas pendentes da mesma conversa', async () => {
    const h = harness();
    h.systemGap.findFirst.mockResolvedValue(h.gap);
    const result = await h.service.createSystem({
      orgId: 'org_1', conversationId: 'conv_1', departmentId: 'dep_1',
      reason: 'sem_contexto', question: 'Como resolver?', context: {},
    });
    expect(result).toBe(h.gap);
    expect(h.systemGap.create).not.toHaveBeenCalled();
  });

  it('registra a orientação interna e devolve a conversa para a IA', async () => {
    const h = harness();
    const result = await h.service.answer('gap_1', supervisor as never, '  Oriente o cliente a reiniciar a ONU.  ');

    expect(result.status).toBe(KnowledgeGapStatus.ANSWERED);
    expect(h.tx.knowledgeGap.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ answer: 'Oriente o cliente a reiniciar a ONU.', responderId: 'supervisor_1' }),
    }));
    expect(h.tx.message.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ conversationId: 'conv_1', type: 'SYSTEM' }),
    }));
    expect(h.queue.add).toHaveBeenCalledWith('reply-after-gap', {
      orgId: 'org_1', conversationId: 'conv_1', messageId: 'msg_internal_1',
    });
  });

  it('não permite responder novamente ou responder uma dúvida inexistente', async () => {
    const h = harness();
    h.tenantGap.findFirst.mockResolvedValueOnce({ ...h.gap, status: KnowledgeGapStatus.ANSWERED });
    await expect(h.service.answer('gap_1', supervisor as never, 'Resposta')).rejects.toBeInstanceOf(BadRequestException);
    h.tenantGap.findFirst.mockResolvedValueOnce(null);
    await expect(h.service.answer('gap_missing', supervisor as never, 'Resposta')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('permite ao supervisor descartar com justificativa sem reenfileirar a IA', async () => {
    const h = harness();
    const result = await h.service.dismiss('gap_1', supervisor as never, 'GAP gerado por cenário já corrigido.');

    expect(result.status).toBe(KnowledgeGapStatus.DISMISSED);
    expect(h.tenantGap.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'gap_1' },
      data: expect.objectContaining({
        status: KnowledgeGapStatus.DISMISSED,
        answer: 'GAP gerado por cenário já corrigido.',
      }),
    }));
    expect(h.queue.add).not.toHaveBeenCalled();
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'knowledge-gap.dismissed' }));
  });

  it('não permite que agente descarte uma dúvida do próprio setor', async () => {
    const h = harness();
    await expect(h.service.dismiss('gap_1', agent as never, 'Não é necessário manter esta dúvida.'))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('agente visualiza e responde somente dúvidas do próprio setor', async () => {
    const h = harness();
    await h.service.list(agent as never, KnowledgeGapStatus.PENDING);
    expect(h.tenantGap.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { status: KnowledgeGapStatus.PENDING, departmentId: 'dep_1' },
    }));

    h.tenantGap.findFirst.mockResolvedValueOnce({ ...h.gap, departmentId: 'dep_2' });
    await expect(h.service.answer('gap_1', agent as never, 'Resposta')).rejects.toBeInstanceOf(ForbiddenException);
  });
});
