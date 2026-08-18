import { Module } from '@nestjs/common';
import { SentryService } from './sentry.service';

/**
 * SentryModule (CONTRACTS §14): SentryService é no-op quando SENTRY_DSN
 * está vazio (ver sentry.service.ts). SentryExceptionFilter é instanciado
 * via APP_FILTER em observability.module.ts (useClass resolve SentryService
 * a partir do export deste módulo).
 */
@Module({
  providers: [SentryService],
  exports: [SentryService],
})
export class SentryModule {}
