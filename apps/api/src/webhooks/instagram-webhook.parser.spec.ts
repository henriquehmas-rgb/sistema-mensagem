import { MessageType } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  instagramExternalMessageId,
  mapInstagramContent,
  parseInstagramMessagingEvent,
  type InstagramMessagingEvent,
} from './instagram-webhook.parser';

const IG_BUSINESS_ID = '17841400000000001';
const IG_USER_ID = '1234567890000001';
const MID = 'aWdfZGlyZWN0Om1pZC0wMDE';

const entry = { id: IG_BUSINESS_ID };

function textEvent(overrides: Partial<InstagramMessagingEvent> = {}): InstagramMessagingEvent {
  return {
    sender: { id: IG_USER_ID },
    recipient: { id: IG_BUSINESS_ID },
    timestamp: 1755500000000,
    message: { mid: MID, text: 'Olá, vi o produto no stories!' },
    ...overrides,
  };
}

describe('parseInstagramMessagingEvent', () => {
  it('mensagem de texto → evento message roteável pelo ig business id', () => {
    const parsed = parseInstagramMessagingEvent(entry, textEvent());
    expect(parsed).toEqual({
      kind: 'message',
      igBusinessId: IG_BUSINESS_ID,
      senderId: IG_USER_ID,
      mid: MID,
      items: [{ type: MessageType.TEXT, content: { text: 'Olá, vi o produto no stories!' } }],
    });
  });

  it('echo (message.is_echo) é ignorado — nunca vira Message INBOUND', () => {
    const event = {
      sender: { id: IG_BUSINESS_ID },
      recipient: { id: IG_USER_ID },
      message: { mid: MID, text: 'resposta do business', is_echo: true },
    };
    const parsed = parseInstagramMessagingEvent(entry, event);
    expect(parsed).toEqual({ kind: 'ignored', reason: 'echo', mid: MID });
  });

  it('mensagem do próprio business (sender == entry.id) sem is_echo é ignorada', () => {
    const event = {
      sender: { id: IG_BUSINESS_ID },
      recipient: { id: IG_USER_ID },
      message: { mid: MID, text: 'oi' },
    };
    const parsed = parseInstagramMessagingEvent(entry, event);
    expect(parsed).toEqual({ kind: 'ignored', reason: 'self', mid: MID });
  });

  it('sem mid ou sem sender → malformed', () => {
    expect(
      parseInstagramMessagingEvent(entry, textEvent({ message: { text: 'sem mid' } })),
    ).toEqual({ kind: 'ignored', reason: 'malformed', mid: null });
    expect(parseInstagramMessagingEvent(entry, textEvent({ sender: {} }))).toEqual({
      kind: 'ignored',
      reason: 'malformed',
      mid: MID,
    });
  });

  it('evento sem message nem read (ex.: reaction) → unsupported', () => {
    const parsed = parseInstagramMessagingEvent(entry, {
      sender: { id: IG_USER_ID },
      recipient: { id: IG_BUSINESS_ID },
    });
    expect(parsed).toEqual({ kind: 'ignored', reason: 'unsupported', mid: null });
  });

  it('mensagem sem texto e sem anexos → unsupported', () => {
    const parsed = parseInstagramMessagingEvent(entry, textEvent({ message: { mid: MID } }));
    expect(parsed).toEqual({ kind: 'ignored', reason: 'unsupported', mid: MID });
  });

  it('recibo de leitura → evento read com o mid da última mensagem lida', () => {
    const parsed = parseInstagramMessagingEvent(entry, {
      sender: { id: IG_USER_ID },
      recipient: { id: IG_BUSINESS_ID },
      read: { mid: MID },
    });
    expect(parsed).toEqual({
      kind: 'read',
      igBusinessId: IG_BUSINESS_ID,
      senderId: IG_USER_ID,
      lastReadMid: MID,
    });
  });

  it('read sem mid → malformed', () => {
    const parsed = parseInstagramMessagingEvent(entry, {
      sender: { id: IG_USER_ID },
      recipient: { id: IG_BUSINESS_ID },
      read: {},
    });
    expect(parsed).toEqual({ kind: 'ignored', reason: 'malformed', mid: null });
  });
});

describe('mapInstagramContent', () => {
  const url = (name: string) => `https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=${name}`;

  it('anexos image/video/audio/file → tipos de mídia com a URL do CDN da Meta', () => {
    const cases: Array<[string, MessageType]> = [
      ['image', MessageType.IMAGE],
      ['video', MessageType.VIDEO],
      ['audio', MessageType.AUDIO],
      ['file', MessageType.DOCUMENT],
    ];
    for (const [attachmentType, expected] of cases) {
      const items = mapInstagramContent({
        mid: MID,
        attachments: [{ type: attachmentType, payload: { url: url(attachmentType) } }],
      });
      expect(items, attachmentType).toEqual([
        { type: expected, content: { mediaUrl: url(attachmentType), mimeType: null } },
      ]);
    }
  });

  it('story_mention vira IMAGE com a mídia do story', () => {
    const items = mapInstagramContent({
      mid: MID,
      attachments: [{ type: 'story_mention', payload: { url: url('story') } }],
    });
    expect(items).toEqual([
      { type: MessageType.IMAGE, content: { mediaUrl: url('story'), mimeType: null } },
    ]);
  });

  it('texto junto de anexo vira caption do primeiro anexo', () => {
    const items = mapInstagramContent({
      mid: MID,
      text: 'olha essa foto',
      attachments: [
        { type: 'image', payload: { url: url('a') } },
        { type: 'image', payload: { url: url('b') } },
      ],
    });
    expect(items).toEqual([
      { type: MessageType.IMAGE, content: { mediaUrl: url('a'), mimeType: null, caption: 'olha essa foto' } },
      { type: MessageType.IMAGE, content: { mediaUrl: url('b'), mimeType: null } },
    ]);
  });

  it('share vira TEXT preservando o link', () => {
    const items = mapInstagramContent({
      mid: MID,
      attachments: [{ type: 'share', payload: { url: 'https://www.instagram.com/p/abc/' } }],
    });
    expect(items).toEqual([
      { type: MessageType.TEXT, content: { text: '[share] https://www.instagram.com/p/abc/' } },
    ]);
  });

  it('anexo desconhecido sem URL vira placeholder textual', () => {
    const items = mapInstagramContent({ mid: MID, attachments: [{ type: 'like_heart' }] });
    expect(items).toEqual([
      { type: MessageType.TEXT, content: { text: '[anexo não suportado: like_heart]' } },
    ]);
  });
});

describe('instagramExternalMessageId', () => {
  it('mid puro no primeiro item; sufixo por índice nos demais (dedupe por unique)', () => {
    expect(instagramExternalMessageId(MID, 0)).toBe(MID);
    expect(instagramExternalMessageId(MID, 1)).toBe(`${MID}:1`);
    expect(instagramExternalMessageId(MID, 2)).toBe(`${MID}:2`);
  });
});
