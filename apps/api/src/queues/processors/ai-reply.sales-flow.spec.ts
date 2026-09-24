import { MessageDirection, MessageType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AiReplyProcessor, salesFirstContactOpening } from './ai-reply.processor';

describe('fluxo comercial determinístico', () => {
  it('grava Vendas antes de pedir a localização, preservando a rota para a mensagem seguinte', async () => {
    const conversation = {
      aiEnabled: true,
      identityVerifiedAt: null,
      lastIntent: null as string | null,
      contact: { id: 'contact', memorySummary: null },
      department: null,
    };
    const applyTriage = vi.fn(async (_org: string, _conversation: string, intent: string) => {
      conversation.lastIntent = intent;
      return 'sales-department';
    });
    const handleSalesAutoViability = vi.fn();
    let salesTurns = 0;
    const refresh = vi.fn(async ({ route }: { route: string | null }) => ({
      schemaVersion: 1, route: route === 'sales' ? 'sales' : 'other',
      coverageCheckStatus: 'NOT_CHECKED', nextStep: 'ASK_ADDRESS',
    }));
    const resolve = vi.fn(async ({ caseState }: { caseState: { route: string } }) => {
      if (caseState.route !== 'sales') return { kind: 'NONE' };
      salesTurns += 1;
      return salesTurns === 1
        ? { kind: 'REPLY', reply: 'Compartilhe sua localização.' }
        : { kind: 'EXECUTE', input: { latitude: -16.066495, longitude: -57.668644 } };
    });
    const processor = Object.assign(Object.create(AiReplyProcessor.prototype) as object, {
      prisma: { prismaSystem: {
        conversation: { findFirst: vi.fn().mockResolvedValue(conversation) },
        message: {
          findFirst: vi.fn()
            .mockResolvedValueOnce({ createdAt: new Date('2026-09-23T02:00:00Z') })
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ createdAt: new Date('2026-09-23T02:01:00Z') })
            .mockResolvedValueOnce(null),
          findMany: vi.fn()
            .mockResolvedValueOnce([{
              direction: MessageDirection.INBOUND, type: MessageType.TEXT,
              content: { text: 'Quero um plano de internet' },
            }])
            .mockResolvedValueOnce([
              { direction: MessageDirection.INBOUND, type: MessageType.LOCATION, content: { latitude: -16.066495, longitude: -57.668644 } },
              { direction: MessageDirection.OUTBOUND, type: MessageType.TEXT, content: { text: 'Compartilhe sua localização.' } },
              { direction: MessageDirection.INBOUND, type: MessageType.TEXT, content: { text: 'Quero um plano de internet' } },
            ]),
        },
      } },
      supportCaseState: { refresh },
      salesAutoViabilityFlow: { resolve },
      applyTriage,
      handleSalesAutoViability,
    }) as unknown as AiReplyProcessor;

    await processor.process({ data: {
      orgId: 'org', conversationId: 'conversation', messageId: 'inbound', coalesce: false,
    } } as never);

    expect(refresh).toHaveBeenCalledWith(expect.objectContaining({ route: 'sales' }));
    expect(applyTriage).toHaveBeenCalledWith(
      'org', 'conversation', 'sales', 'sales', 0.9, expect.anything(),
      false, null, null, false, ['deterministic_sales_auto_viability'],
    );
    expect(conversation.lastIntent).toBe('sales');
    expect(handleSalesAutoViability).toHaveBeenCalledWith(
      'org', 'conversation', { kind: 'REPLY', reply: 'Compartilhe sua localização.' },
      false, 'ASK_ADDRESS', null, true,
    );

    await processor.process({ data: {
      orgId: 'org', conversationId: 'conversation', messageId: 'location', coalesce: false,
    } } as never);
    expect(refresh).toHaveBeenLastCalledWith(expect.objectContaining({ route: 'sales' }));
    expect(handleSalesAutoViability).toHaveBeenLastCalledWith(
      'org', 'conversation', { kind: 'EXECUTE', input: { latitude: -16.066495, longitude: -57.668644 } },
      false, 'ASK_ADDRESS', null, false,
    );
  });

  it('usa o horário de Mato Grosso e saúda antes de solicitar a localização', async () => {
    expect(salesFirstContactOpening(new Date('2026-09-23T14:00:00Z'))).toBe('Bom dia! Tudo bem?');
    expect(salesFirstContactOpening(new Date('2026-09-23T20:00:00Z'))).toBe('Boa tarde! Tudo bem?');
    expect(salesFirstContactOpening(new Date('2026-09-23T02:00:00Z'))).toBe('Boa noite! Tudo bem?');
    const handleReply = vi.fn();
    const processor = Object.assign(Object.create(AiReplyProcessor.prototype) as AiReplyProcessor, { handleReply });
    await (processor as unknown as { handleSalesAutoViability: (...args: unknown[]) => Promise<void> })
      .handleSalesAutoViability('org', 'conversation', {
        kind: 'REPLY', reply: 'Compartilhe sua localização.',
      }, false, 'ASK_ADDRESS', null, true);
    expect(handleReply).toHaveBeenCalledWith(
      'org', 'conversation', expect.stringMatching(/^(Bom dia|Boa tarde|Boa noite)! Tudo bem\?\n\nCompartilhe sua localização\.$/),
      'direto', false, expect.any(Array), expect.any(Object), null,
    );
  });
});
