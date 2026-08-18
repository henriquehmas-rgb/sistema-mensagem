import { Writable } from 'node:stream';
import type { ConfigService } from '@nestjs/config';
import pino, { type Logger as PinoLogger } from 'pino';
import { describe, expect, it } from 'vitest';
import type { Env } from '../../config/env.validation';
import { TenancyService } from '../../tenancy/tenancy.service';
import { AppLogger } from './app-logger.service';

function createConfig(): ConfigService<Env, true> {
  return { get: () => 'test' } as unknown as ConfigService<Env, true>;
}

/**
 * `AppLogger.createRootLogger` sempre escreve em stdout (produção real nunca
 * precisa de outro destino) — para inspecionar a linha JSON gerada, trocamos
 * o `root` privado por uma instância pino apontando para um sink em memória
 * depois da construção normal via DI.
 */
function createLoggerWithSink(): { logger: AppLogger; lines: () => Record<string, unknown>[] } {
  const chunks: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });

  const logger = new AppLogger(createConfig(), new TenancyService());
  (logger as unknown as { root: PinoLogger }).root = pino({ level: 'debug' }, sink);

  return {
    logger,
    lines: () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

/**
 * CONTRACTS §14: logs estruturados nunca podem virar uma linha vazia/opaca
 * para um Error (achado do crítico — `JSON.stringify(new Error(...))` produz
 * '{}') nem vazar credenciais anexadas a um Error (achado combinado com
 * redact.ts).
 */
describe('AppLogger — serialização de Error', () => {
  it('nunca produz "{}" para um Error simples — preserva message/stack como texto legível', () => {
    const { logger, lines } = createLoggerWithSink();
    logger.error(new Error('DB connection failed for org X'));

    const [line] = lines();
    expect(line.msg).not.toBe('{}');
    expect(line.msg).toContain('DB connection failed for org X');
    expect((line.err as { message: string }).message).toBe('DB connection failed for org X');
    expect((line.err as { name: string }).name).toBe('Error');
  });

  it('redige propriedades sensíveis anexadas a um Error antes de logar (nunca em texto plano)', () => {
    const { logger, lines } = createLoggerWithSink();
    const error = Object.assign(new Error('request failed'), {
      config: { headers: { authorization: 'Bearer super-secret-meta-token' } },
      accessToken: 'plain-secret-token',
    });
    logger.error(error);

    const [line] = lines();
    const serialized = JSON.stringify(line);
    expect(serialized).not.toContain('super-secret-meta-token');
    expect(serialized).not.toContain('plain-secret-token');
    const err = line.err as { config: { headers: { authorization: string } }; accessToken: string };
    expect(err.config.headers.authorization).toBe('[REDACTED]');
    expect(err.accessToken).toBe('[REDACTED]');
  });

  it('mensagem string comum continua sendo logada como texto simples (sem regressão)', () => {
    const { logger, lines } = createLoggerWithSink();
    logger.log('mensagem simples');

    const [line] = lines();
    expect(line.msg).toBe('mensagem simples');
  });
});
