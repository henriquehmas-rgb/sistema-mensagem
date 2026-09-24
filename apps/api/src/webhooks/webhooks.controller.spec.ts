import 'reflect-metadata';
import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebhooksController } from './webhooks.controller';

/**
 * Contrato de borda do canal Meta: payload forjado nunca alcança a fila e
 * reentregas válidas recebem 200 de imediato para o processor fazer dedupe.
 */
const APP_SECRET = 'test-meta-app-secret';
const VERIFY_TOKEN = 'test-meta-verify-token';

function signed(rawBody: Buffer): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
}

function createHarness() {
  const queue = { add: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: vi.fn((key: string) => (key === 'META_APP_SECRET' ? APP_SECRET : VERIFY_TOKEN)),
  };
  return {
    queue,
    controller: new WebhooksController(config as never, queue as never),
  };
}

describe('WebhooksController — borda Meta', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('aceita handshake somente com token configurado', () => {
    expect(harness.controller.verify('subscribe', VERIFY_TOKEN, 'challenge-1')).toBe('challenge-1');
    expect(() => harness.controller.verify('subscribe', 'outro-token', 'challenge-1')).toThrow(
      'Verificação de webhook inválida',
    );
  });

  it('descarta assinatura ausente ou inválida sem enfileirar', async () => {
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}', 'utf8');
    const response = await harness.controller.receive({ rawBody } as never, { object: 'x' }, 'sha256=invalida');

    expect(response).toEqual({ received: true });
    expect(harness.queue.add).not.toHaveBeenCalled();
  });

  it('enfileira payload assinado, sem processá-lo no request', async () => {
    const body = { object: 'whatsapp_business_account', entry: [] };
    const rawBody = Buffer.from(JSON.stringify(body), 'utf8');
    const signature = signed(rawBody);

    await expect(harness.controller.receive({ rawBody } as never, body, signature)).resolves.toEqual({
      received: true,
    });
    expect(harness.queue.add).toHaveBeenCalledOnce();
    expect(harness.queue.add).toHaveBeenCalledWith(
      'meta',
      expect.objectContaining({
        source: 'meta',
        body,
        headers: { 'x-hub-signature-256': signature },
      }),
    );
  });
});
