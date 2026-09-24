import { describe, expect, it, vi } from 'vitest';
import { AiReplyProcessor } from './ai-reply.processor';

describe('AiReplyProcessor — publicação do turno', () => {
  it('adquire o lock sem retornar void ao Prisma e enfileira cada parte da resposta', async () => {
    const created: Array<{ id: string; createdAt: Date; content: { text: string } }> = [];
    const tx = {
      $queryRaw: vi.fn(async (parts: TemplateStringsArray) => {
        if (!parts.join('?').includes('::text AS lock_acquired')) {
          throw new Error("Failed to deserialize column of type 'void'");
        }
        return [{ lock_acquired: '' }];
      }),
      message: {
        findFirst: vi.fn()
          .mockResolvedValueOnce({ id: 'inbound-latest' })
          .mockResolvedValueOnce(null),
        create: vi.fn(async ({ data }: { data: { content: { text: string } } }) => {
          const message = {
            id: `outbound-${created.length + 1}`,
            createdAt: new Date(),
            content: data.content,
          };
          created.push(message);
          return message;
        }),
      },
      conversation: { update: vi.fn() },
    };
    const add = vi.fn();
    const emitMessageNew = vi.fn();
    const processor = Object.assign(Object.create(AiReplyProcessor.prototype) as AiReplyProcessor, {
      prisma: { prismaSystem: { $transaction: (run: (client: typeof tx) => Promise<unknown>) => run(tx) } },
      messageOutboundQueue: { add },
      emitMessageNew,
    });

    const published = await (processor as unknown as {
      handleReply: (...args: unknown[]) => Promise<boolean>;
    }).handleReply(
      'org', 'conversation', 'Bom dia! Tudo bem?\n\nMe conte o que aconteceu.',
      'direto', false, [], { traceExpectation: 'reply', traceReason: 'test' },
      'inbound-latest',
    );

    expect(published).toBe(true);
    expect(created.map((message) => message.content.text)).toEqual([
      'Bom dia! Tudo bem?', 'Me conte o que aconteceu.',
    ]);
    expect(tx.$queryRaw).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledTimes(2);
    expect(emitMessageNew).toHaveBeenCalledTimes(2);
  });
});
