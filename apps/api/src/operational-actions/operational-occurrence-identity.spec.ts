import { describe, expect, it } from 'vitest';
import { deriveOccurrenceId } from './operational-occurrence-identity';

describe('deriveOccurrenceId', () => {
  it('é estável no retry e muda em uma nova mensagem sem evento de rede', () => {
    const base = { conversationId: 'conv_1', messageId: 'msg_1', customerId: 'customer_1' };
    expect(deriveOccurrenceId(base)).toBe(deriveOccurrenceId(base));
    expect(deriveOccurrenceId(base)).not.toBe(deriveOccurrenceId({ ...base, messageId: 'msg_2' }));
  });

  it('preserva a ocorrência entre mensagens quando existe o mesmo EventID', () => {
    const first = deriveOccurrenceId({
      conversationId: 'conv_1', messageId: 'msg_1', customerId: 'customer_1', networkEventId: 'event_10',
    });
    const next = deriveOccurrenceId({
      conversationId: 'conv_1', messageId: 'msg_2', customerId: 'customer_1', networkEventId: 'event_10',
    });
    expect(first).toBe(next);
  });
});

