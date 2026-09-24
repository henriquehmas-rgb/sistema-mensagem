import { MessageDirection, MessageType } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { AiReplyProcessor } from './ai-reply.processor';

describe('troca de titular em Suporte e Financeiro', () => {
  it.each([
    { route: 'technical_support', identityActive: true, userReply: 'Endereço sim, mas o CPF é diferente' },
    { route: 'technical_support', identityActive: false, userReply: 'Endereço sim, CPF difere' },
    { route: 'billing', identityActive: true, userReply: 'Essa fatura é de outro CPF' },
    { route: 'billing', identityActive: false, userReply: 'O CPF difere' },
  ] as const)('pede o CPF do titular correto e limpa a evidência anterior ($route, vínculo ativo: $identityActive, resposta: $userReply)', async ({ route, identityActive, userReply }) => {
    const clear = vi.fn().mockResolvedValue(undefined);
    const beginAccountHolderRebind = vi.fn().mockResolvedValue(true);
    const handleReply = vi.fn().mockResolvedValue(true);
    const handleHandoff = vi.fn();
    const processor = Object.assign(Object.create(AiReplyProcessor.prototype) as object, {
      prisma: { prismaSystem: {
        conversation: { findFirst: vi.fn().mockResolvedValue({
          aiEnabled: true, identityVerifiedAt: identityActive ? new Date() : null, lastIntent: route,
          contact: { id: 'contact', memorySummary: null }, department: { routingKey: route },
        }) },
        message: {
          findFirst: vi.fn().mockResolvedValueOnce({ createdAt: new Date() }).mockResolvedValueOnce(null),
          findMany: vi.fn().mockResolvedValue([
            { direction: MessageDirection.INBOUND, type: MessageType.TEXT, content: { text: userReply } },
            { direction: MessageDirection.OUTBOUND, type: MessageType.TEXT, content: { text: route === 'billing' ? 'Encontrei uma fatura nesse cadastro.' : 'Essa internet está no mesmo CPF e endereço desse cadastro?' } },
            { direction: MessageDirection.INBOUND, type: MessageType.TEXT, content: { text: route === 'billing' ? 'Preciso da segunda via da fatura' : 'Estou sem internet' } },
          ]),
        },
      } },
      ixcEvidenceCache: { clear },
      ixc: { beginAccountHolderRebind },
      handleReply,
      handleHandoff,
    }) as unknown as AiReplyProcessor;

    await processor.process({ data: {
      orgId: 'org', conversationId: 'conversation', messageId: 'inbound', coalesce: false,
    } } as never);

    expect(beginAccountHolderRebind).toHaveBeenCalledWith('org', 'conversation', 'contact', route);
    expect(clear).toHaveBeenCalledWith('org', 'conversation');
    expect(beginAccountHolderRebind.mock.invocationCallOrder[0]).toBeLessThan(clear.mock.invocationCallOrder[0]!);
    expect(handleReply).toHaveBeenCalledWith(
      'org', 'conversation', expect.stringContaining(route === 'billing' ? 'CPF completo do titular dessa conta' : 'CPF completo do titular dessa internet'),
      'direto', true, [route === 'billing' ? 'policy:billing-account-holder-rebind' : 'policy:support-account-holder-rebind'],
      expect.any(Object), null,
    );
    expect(handleHandoff).not.toHaveBeenCalled();
  });

  it.each(['technical_support', 'billing'] as const)('esclarece divergência incerta sem consultar o vínculo anterior (%s)', async (route) => {
    const beginAccountHolderRebind = vi.fn();
    const clear = vi.fn();
    const handleReply = vi.fn().mockResolvedValue(true);
    const handleHandoff = vi.fn();
    const processor = Object.assign(Object.create(AiReplyProcessor.prototype) as object, {
      prisma: { prismaSystem: {
        conversation: { findFirst: vi.fn().mockResolvedValue({
          aiEnabled: true, identityVerifiedAt: new Date(), lastIntent: route,
          contact: { id: 'contact', memorySummary: null }, department: { routingKey: route },
        }) },
        message: {
          findFirst: vi.fn().mockResolvedValueOnce({ createdAt: new Date() }).mockResolvedValueOnce(null),
          findMany: vi.fn().mockResolvedValue([
            { direction: MessageDirection.INBOUND, type: MessageType.TEXT, content: { text: 'Acho que o CPF difere' } },
            { direction: MessageDirection.OUTBOUND, type: MessageType.TEXT, content: { text: route === 'billing' ? 'Encontrei uma fatura nesse cadastro.' : 'Essa internet está no mesmo CPF e endereço desse cadastro?' } },
          ]),
        },
      } },
      ixcEvidenceCache: { clear },
      ixc: { beginAccountHolderRebind },
      handleReply,
      handleHandoff,
    }) as unknown as AiReplyProcessor;

    await processor.process({ data: {
      orgId: 'org', conversationId: 'conversation', messageId: 'inbound', coalesce: false,
    } } as never);

    expect(handleReply).toHaveBeenCalledWith(
      'org', 'conversation', expect.stringContaining('o CPF do titular'),
      'direto', true, ['policy:account-holder-clarification'], expect.any(Object), null,
    );
    expect(beginAccountHolderRebind).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(handleHandoff).not.toHaveBeenCalled();
  });
});
