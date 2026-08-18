import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import { MessageType } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env.validation';
import type { CryptoService } from '../crypto/crypto.service';
import { GraphPermanentError, MetaGraphService } from './meta-graph.service';

/**
 * MetaGraphService: sync de templates (paginação via paging.next) e a
 * correção do bug de leitura do idioma em mensagens TEMPLATE (CONTRACTS §12:
 * `content.language`, não `content.languageCode`).
 */

function configMock(publicUrl = 'https://chat.example.com'): ConfigService<Env, true> {
  return {
    get: vi.fn((key: string) => (key === 'PUBLIC_URL' ? publicUrl : 'v21.0')),
  } as unknown as ConfigService<Env, true>;
}

function cryptoMock(): CryptoService {
  return { decrypt: vi.fn(), encrypt: vi.fn() } as unknown as CryptoService;
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as unknown as Response;
}

describe('MetaGraphService', () => {
  let service: MetaGraphService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = new MetaGraphService(configMock(), cryptoMock());
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('syncTemplates', () => {
    it('busca a primeira página com os fields corretos', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: [
            {
              name: 'hello_world',
              language: 'pt_BR',
              status: 'APPROVED',
              category: 'MARKETING',
              components: [],
            },
          ],
        }),
      );

      const result = await service.syncTemplates({ accessToken: 'tok' }, 'waba123');

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        'https://graph.facebook.com/v21.0/waba123/message_templates?fields=name,language,status,category,components&limit=100',
        expect.objectContaining({ method: 'GET' }),
      );
      expect(result).toEqual([
        {
          name: 'hello_world',
          language: 'pt_BR',
          status: 'APPROVED',
          category: 'MARKETING',
          components: [],
        },
      ]);
    });

    it('segue paging.next (URL absoluta) até esgotar as páginas', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            data: [{ name: 'a', language: 'pt_BR', status: 'APPROVED', category: 'MARKETING', components: [] }],
            paging: { next: 'https://graph.facebook.com/v21.0/waba123/message_templates?after=CURSOR1' },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: [{ name: 'b', language: 'en_US', status: 'PENDING', category: 'UTILITY', components: [] }],
            paging: { next: 'https://graph.facebook.com/v21.0/waba123/message_templates?after=CURSOR2' },
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: [{ name: 'c', language: 'es_ES', status: 'REJECTED', category: 'UTILITY', components: [] }],
          }),
        );

      const result = await service.syncTemplates({ accessToken: 'tok' }, 'waba123');

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(fetchMock.mock.calls[1]?.[0]).toBe(
        'https://graph.facebook.com/v21.0/waba123/message_templates?after=CURSOR1',
      );
      expect(fetchMock.mock.calls[2]?.[0]).toBe(
        'https://graph.facebook.com/v21.0/waba123/message_templates?after=CURSOR2',
      );
      expect(result.map((template) => template.name)).toEqual(['a', 'b', 'c']);
    });

    it('sem accessToken/wabaId → GraphPermanentError sem chamar a Graph API', async () => {
      await expect(service.syncTemplates({}, '')).rejects.toBeInstanceOf(GraphPermanentError);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('resposta de erro da Graph API → Error com descrição', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { message: 'Invalid token', code: 190 } }, false),
      );
      await expect(service.syncTemplates({ accessToken: 'tok' }, 'waba123')).rejects.toThrow(
        /Invalid token/,
      );
    });

    it('paging.next para host fora de graph.facebook.com → aborta sem seguir (anti-SSRF/vazamento de token)', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          data: [{ name: 'a', language: 'pt_BR', status: 'APPROVED', category: 'MARKETING', components: [] }],
          paging: { next: 'https://evil.example.com/steal?token=x' },
        }),
      );

      await expect(service.syncTemplates({ accessToken: 'tok' }, 'waba123')).rejects.toThrow(
        /host inesperado/,
      );
      // Só a primeira página foi buscada — nunca chegou a seguir o host malicioso.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('paginação sem fim → aborta após o teto de páginas', async () => {
      fetchMock.mockImplementation(() =>
        Promise.resolve(
          jsonResponse({
            data: [],
            paging: { next: 'https://graph.facebook.com/v21.0/waba123/message_templates?after=LOOP' },
          }),
        ),
      );

      await expect(service.syncTemplates({ accessToken: 'tok' }, 'waba123')).rejects.toThrow(
        /excedeu/,
      );
      expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(51);
    });
  });

  describe('sendWhatsAppMessage — TEMPLATE (correção do idioma)', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(jsonResponse({ messages: [{ id: 'wamid.123' }] }));
    });

    it('lê content.language (não content.languageCode)', async () => {
      await service.sendWhatsAppMessage(
        { accessToken: 'tok', phoneNumberId: 'pn1' },
        '5511999999999',
        MessageType.TEMPLATE,
        { templateName: 'hello_world', language: 'en_US', params: ['Ana'] },
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        template: { language: { code: string } };
      };
      expect(body.template.language.code).toBe('en_US');
    });

    it('sem language no content → fallback pt_BR', async () => {
      await service.sendWhatsAppMessage(
        { accessToken: 'tok', phoneNumberId: 'pn1' },
        '5511999999999',
        MessageType.TEMPLATE,
        { templateName: 'hello_world' },
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        template: { language: { code: string } };
      };
      expect(body.template.language.code).toBe('pt_BR');
    });

    it('languageCode (campo antigo/errado) é ignorado — cai no fallback pt_BR', async () => {
      await service.sendWhatsAppMessage(
        { accessToken: 'tok', phoneNumberId: 'pn1' },
        '5511999999999',
        MessageType.TEMPLATE,
        { templateName: 'hello_world', languageCode: 'en_US' },
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        template: { language: { code: string } };
      };
      expect(body.template.language.code).toBe('pt_BR');
    });
  });

  /**
   * Crítico (revisão de uploads): MediaService.storeUpload/o re-host inbound
   * devolvem mediaUrl RELATIVO (`/api/media/{orgId}/...`) — sem resolver contra
   * PUBLIC_URL, a Graph API da Meta recebe um link sem scheme/host e não
   * consegue baixar a mídia. Cobre WhatsApp (buildMessagePayload) e Instagram
   * (buildInstagramMessagePayload).
   */
  describe('mediaUrl relativo → absoluto antes da Graph API (crítico)', () => {
    beforeEach(() => {
      fetchMock.mockResolvedValue(jsonResponse({ messages: [{ id: 'wamid.123' }], message_id: 'ig.123' }));
    });

    it('WhatsApp IMAGE: prefixa PUBLIC_URL num mediaUrl relativo de upload', async () => {
      service = new MetaGraphService(configMock('https://chat.example.com'), cryptoMock());
      await service.sendWhatsAppMessage(
        { accessToken: 'tok', phoneNumberId: 'pn1' },
        '5511999999999',
        MessageType.IMAGE,
        { mediaUrl: '/api/media/org1/uploads/abc123.jpg' },
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { image: { link: string } };
      expect(body.image.link).toBe('https://chat.example.com/api/media/org1/uploads/abc123.jpg');
    });

    it('WhatsApp: não mexe em mediaUrl já absoluta (aba "Por URL")', async () => {
      service = new MetaGraphService(configMock('https://chat.example.com'), cryptoMock());
      await service.sendWhatsAppMessage(
        { accessToken: 'tok', phoneNumberId: 'pn1' },
        '5511999999999',
        MessageType.IMAGE,
        { mediaUrl: 'https://cdn.exemplo.com/foto.jpg' },
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { image: { link: string } };
      expect(body.image.link).toBe('https://cdn.exemplo.com/foto.jpg');
    });

    it('WhatsApp: remove barra dupla mesmo com PUBLIC_URL terminando em "/"', async () => {
      service = new MetaGraphService(configMock('https://chat.example.com/'), cryptoMock());
      await service.sendWhatsAppMessage(
        { accessToken: 'tok', phoneNumberId: 'pn1' },
        '5511999999999',
        MessageType.DOCUMENT,
        { mediaUrl: '/api/media/org1/uploads/doc.pdf', filename: 'contrato.pdf' },
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as { document: { link: string } };
      expect(body.document.link).toBe('https://chat.example.com/api/media/org1/uploads/doc.pdf');
    });

    it('Instagram Direct: prefixa PUBLIC_URL no attachment.payload.url', async () => {
      service = new MetaGraphService(configMock('https://chat.example.com'), cryptoMock());
      await service.sendInstagramMessage(
        { accessToken: 'tok', igBusinessId: 'ig1' },
        'igsid-1',
        MessageType.IMAGE,
        { mediaUrl: '/api/media/org1/uploads/abc123.jpg' },
      );

      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(init.body as string) as {
        message: { attachment: { payload: { url: string } } };
      };
      expect(body.message.attachment.payload.url).toBe(
        'https://chat.example.com/api/media/org1/uploads/abc123.jpg',
      );
    });
  });
});
