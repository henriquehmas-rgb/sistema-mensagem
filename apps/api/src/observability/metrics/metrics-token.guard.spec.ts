import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.validation';
import { MetricsTokenGuard } from './metrics-token.guard';

function createContext(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
    }),
  } as unknown as ExecutionContext;
}

function createConfig(token: string | undefined): ConfigService<Env, true> {
  return { get: vi.fn(() => token) } as unknown as ConfigService<Env, true>;
}

/** CONTRACTS §14: GET /api/metrics — 401 sem token, 200 (autoriza) com token certo. */
describe('MetricsTokenGuard', () => {
  it('sem header X-Metrics-Token → 401', () => {
    const guard = new MetricsTokenGuard(createConfig('segredo-metrics'));
    expect(() => guard.canActivate(createContext({}))).toThrow(UnauthorizedException);
  });

  it('header com valor errado → 401', () => {
    const guard = new MetricsTokenGuard(createConfig('segredo-metrics'));
    expect(() => guard.canActivate(createContext({ 'x-metrics-token': 'valor-errado' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('METRICS_TOKEN não configurado (dev sem env) → sempre 401, nunca aberto por omissão', () => {
    const guard = new MetricsTokenGuard(createConfig(undefined));
    expect(() =>
      guard.canActivate(createContext({ 'x-metrics-token': 'qualquer-coisa' })),
    ).toThrow(UnauthorizedException);
  });

  it('header com o token correto → autoriza', () => {
    const guard = new MetricsTokenGuard(createConfig('segredo-metrics'));
    expect(guard.canActivate(createContext({ 'x-metrics-token': 'segredo-metrics' }))).toBe(true);
  });
});
