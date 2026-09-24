import { describe, expect, it } from 'vitest';
import { compareTimelineMessageOrder } from './message-ordering.policy';

describe('message ordering policy', () => {
  it('keeps a stable chronology for messages written in the same instant', () => {
    const at = '2026-09-17T18:00:00.000Z';
    const messages = [
      { id: 'msg-b', createdAt: at },
      { id: 'msg-a', createdAt: at },
      { id: 'msg-c', createdAt: '2026-09-17T18:00:01.000Z' },
    ];

    expect(messages.sort(compareTimelineMessageOrder).map((message) => message.id))
      .toEqual(['msg-a', 'msg-b', 'msg-c']);
  });
});
