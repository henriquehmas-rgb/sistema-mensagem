import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.validation';
import { SentryService } from './sentry.service';

vi.mock('@sentry/node', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  close: vi.fn().mockResolvedValue(true),
}));

function createConfig(overrides: {
  SENTRY_DSN?: string;
  NODE_ENV?: string;
}): ConfigService<Env, true> {
  return {
    get: vi.fn((key: string) => (overrides as Record<string, string | undefined>)[key]),
  } as unknown as ConfigService<Env, true>;
}

/**
 * CONTRACTS §14: Sentry no-op TOTAL quando SENTRY_DSN vazio — o guard
 * `if (!dsn) return` em onModuleInit garante que `import('@sentry/node')`
 * (o SDK pesado) nunca executa nesse caminho.
 */
describe('SentryService — sem SENTRY_DSN (no-op)', () => {
  it('onModuleInit não habilita nada quando SENTRY_DSN está ausente', async () => {
    const service = new SentryService(createConfig({ NODE_ENV: 'production' }));
    await service.onModuleInit();
    expect(service.isEnabled()).toBe(false);
  });

  it('onModuleInit não habilita nada quando SENTRY_DSN é string vazia', async () => {
    const service = new SentryService(createConfig({ SENTRY_DSN: '', NODE_ENV: 'development' }));
    await service.onModuleInit();
    expect(service.isEnabled()).toBe(false);
  });

  it('captureException nunca lança e não faz nada quando desabilitado', async () => {
    const service = new SentryService(createConfig({ NODE_ENV: 'development' }));
    await service.onModuleInit();
    expect(() => service.captureException(new Error('boom'))).not.toThrow();
  });
});

describe('SentryService — com SENTRY_DSN configurado', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('inicializa o SDK e delega captureException a ele', async () => {
    // process.on é stubado para NUNCA registrar listeners reais de
    // uncaughtException/unhandledRejection durante o teste (evitaria
    // interferir com o reporter do vitest no mesmo worker thread).
    const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);

    const service = new SentryService(
      createConfig({ SENTRY_DSN: 'https://key@sentry.io/1', NODE_ENV: 'production' }),
    );
    await service.onModuleInit();
    expect(service.isEnabled()).toBe(true);

    const Sentry = await import('@sentry/node');
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://key@sentry.io/1', environment: 'production' }),
    );
    expect(onSpy).toHaveBeenCalledWith('uncaughtException', expect.any(Function));
    expect(onSpy).toHaveBeenCalledWith('unhandledRejection', expect.any(Function));

    const error = new Error('falha não tratada');
    service.captureException(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);
  });

  it('Sentry.init recebe um beforeSend (scrubbing) — nunca envia evento cru', async () => {
    vi.spyOn(process, 'on').mockImplementation(() => process);

    const service = new SentryService(
      createConfig({ SENTRY_DSN: 'https://key@sentry.io/1', NODE_ENV: 'production' }),
    );
    await service.onModuleInit();

    const Sentry = await import('@sentry/node');
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ beforeSend: expect.any(Function) }),
    );
  });

  it('uncaughtException: captura, dá flush (Sentry.close) e encerra o processo (crash-and-restart)', async () => {
    // Achado do crítico: um Sentry habilitado NÃO pode desativar silenciosamente
    // o comportamento padrão de crash-and-restart do Node após um
    // uncaughtException genuíno — o estado do processo deixa de ser confiável.
    const onSpy = vi.spyOn(process, 'on').mockImplementation(() => process);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    const service = new SentryService(
      createConfig({ SENTRY_DSN: 'https://key@sentry.io/1', NODE_ENV: 'production' }),
    );
    await service.onModuleInit();

    const Sentry = await import('@sentry/node');
    // `afterEach` deste describe roda `vi.restoreAllMocks()`, que também reseta
    // a implementação (`mockResolvedValue`) de mocks de módulo entre testes —
    // reafirma o retorno esperado de `close()` para este teste especificamente.
    vi.mocked(Sentry.close).mockResolvedValue(true);

    const uncaughtHandler = onSpy.mock.calls.find(([event]) => event === 'uncaughtException')?.[1] as
      | ((error: unknown) => void)
      | undefined;
    expect(uncaughtHandler).toBeInstanceOf(Function);

    const error = new Error('crash genuíno');
    uncaughtHandler?.(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error);

    await vi.waitFor(() => {
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
    expect(Sentry.close).toHaveBeenCalledWith(2000);
  });
});

/**
 * CONTRACTS §14: nenhuma credencial/PII pode sair da organização via Sentry —
 * `scrubEvent` (usado como `beforeSend`) precisa redigir accessToken/password/
 * Authorization em exception/extra/request/contexts antes do evento seguir
 * para o transporte do SDK.
 */
describe('SentryService.scrubEvent', () => {
  it('redige propriedades sensíveis anexadas à exceção (padrão de erro de biblioteca HTTP de terceiros)', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'Error',
            value: 'request failed',
            // propriedades extras anexadas ao Error original (ex.: axios/config)
            config: { headers: { authorization: 'Bearer super-secret-meta-token' } },
          },
        ],
      },
    } as unknown as Parameters<typeof SentryService.scrubEvent>[0];

    const result = SentryService.scrubEvent(event) as unknown as {
      exception: { values: [{ config: { headers: { authorization: string } } }] };
    };
    expect(result.exception.values[0].config.headers.authorization).toBe('[REDACTED]');
  });

  it('redige extra/request/contexts, preservando o restante do evento intacto', () => {
    const event = {
      level: 'error',
      extra: { accessToken: 'plain-secret', orgId: 'org1' },
      request: { headers: { authorization: 'Bearer x' }, url: '/api/x' },
      contexts: { app: { password: 'hunter2' } },
      tags: { env: 'production' },
    } as unknown as Parameters<typeof SentryService.scrubEvent>[0];

    const result = SentryService.scrubEvent(event) as unknown as {
      level: string;
      extra: { accessToken: string; orgId: string };
      request: { headers: { authorization: string }; url: string };
      contexts: { app: { password: string } };
      tags: { env: string };
    };
    expect(result.extra.accessToken).toBe('[REDACTED]');
    expect(result.extra.orgId).toBe('org1');
    expect(result.request.headers.authorization).toBe('[REDACTED]');
    expect(result.request.url).toBe('/api/x');
    expect(result.contexts.app.password).toBe('[REDACTED]');
    expect(result.level).toBe('error');
    expect(result.tags).toEqual({ env: 'production' });
  });
});
