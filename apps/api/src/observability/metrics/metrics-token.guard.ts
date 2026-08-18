import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { Env } from '../../config/env.validation';

const HEADER = 'x-metrics-token';

/**
 * Guard de GET /api/metrics (CONTRACTS §14): exige `X-Metrics-Token` igual a
 * `METRICS_TOKEN` (ConfigService). 401 se ausente/errado — inclusive quando
 * `METRICS_TOKEN` não está configurado (dev sem a env: acesso sempre negado,
 * nunca "aberto por omissão"). Extraído como classe própria (em vez de lógica
 * inline no controller) para ser testável isoladamente.
 *
 * Comparação via `timingSafeEqual` (mesmo padrão de `webhooks.controller.ts`
 * para o HMAC do webhook Meta) — um `!==` comum vaza, por diferença de tempo
 * de comparação char-a-char, informação sobre quanto do prefixo do token o
 * atacante acertou.
 */
@Injectable()
export class MetricsTokenGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const expected = this.config.get('METRICS_TOKEN', { infer: true });
    const provided = request.headers[HEADER];

    if (!expected || typeof provided !== 'string' || !MetricsTokenGuard.tokensMatch(provided, expected)) {
      throw new UnauthorizedException('Token de métricas ausente ou inválido');
    }
    return true;
  }

  private static tokensMatch(provided: string, expected: string): boolean {
    // timingSafeEqual exige buffers do MESMO tamanho — comparar o tamanho
    // antes é seguro (não vaza informação útil sobre o conteúdo do token).
    const providedBuf = Buffer.from(provided, 'utf8');
    const expectedBuf = Buffer.from(expected, 'utf8');
    if (providedBuf.length !== expectedBuf.length) {
      return false;
    }
    return timingSafeEqual(providedBuf, expectedBuf);
  }
}
