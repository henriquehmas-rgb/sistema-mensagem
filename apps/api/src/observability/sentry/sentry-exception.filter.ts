import { BaseExceptionFilter } from '@nestjs/core';
import { ArgumentsHost, Catch } from '@nestjs/common';
import { SentryService } from './sentry.service';

/**
 * Filtro global de exceções HTTP (CONTRACTS §14): captura no Sentry (no-op
 * se `SENTRY_DSN` vazio — SentryService cuida disso) e SEMPRE delega para
 * `BaseExceptionFilter.catch()` — é o MESMO comportamento padrão do Nest
 * (`ExceptionsHandler`/resposta `{statusCode, message, error}` do CONTRACTS
 * §6), só com a captura extra no meio. Nunca substitui a resposta.
 */
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  constructor(private readonly sentry: SentryService) {
    super();
  }

  override catch(exception: unknown, host: ArgumentsHost): void {
    this.sentry.captureException(exception);
    super.catch(exception, host);
  }
}
