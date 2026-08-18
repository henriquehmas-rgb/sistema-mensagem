import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type * as SentryNode from '@sentry/node';
import type { Env } from '../../config/env.validation';
import { redactSensitive } from '../logging/redact';

/**
 * Sentry opcional (CONTRACTS §14): NO-OP TOTAL quando `SENTRY_DSN` está vazio
 * — nem o SDK (pesado) é importado, por `import()` dinâmico dentro de
 * `onModuleInit` (só executa quando há DSN configurado). Quando habilitado:
 * captura exceções HTTP não tratadas (via SentryExceptionFilter, APP_FILTER)
 * + exceções verdadeiramente não tratadas do processo (erros em processors
 * BullMQ não passam pelo filtro HTTP do Nest — `uncaughtException`/
 * `unhandledRejection` cobrem esse caminho também).
 *
 * `beforeSend` reaproveita a MESMA `redactSensitive` usada pelo AppLogger
 * (evita duplicar a política de redação em dois lugares) para nunca deixar
 * accessToken/password/Authorization saírem da organização — exceções de
 * terceiros ou custom errors às vezes carregam essas chaves como
 * propriedades extras (ver redact.ts), e sem scrubbing aqui elas iriam
 * direto para o servidor Sentry configurado.
 */
@Injectable()
export class SentryService implements OnModuleInit {
  private readonly logger = new Logger(SentryService.name);
  private sdk: typeof SentryNode | null = null;

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit(): Promise<void> {
    const dsn = this.config.get('SENTRY_DSN', { infer: true });
    if (!dsn) {
      return; // no-op total — SDK nunca importado
    }

    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: this.config.get('NODE_ENV', { infer: true }),
      beforeSend: (event) => SentryService.scrubEvent(event),
    });
    this.sdk = Sentry;

    process.on('uncaughtException', (error) => {
      this.captureException(error);
      // Após um uncaughtException genuíno o estado do processo não é mais
      // confiável (recomendação do próprio Node.js) — deixar a API viva
      // silenciosamente violaria o comportamento padrão de crash-and-restart
      // (um supervisor/orquestrador deve reiniciar o processo). `Sentry.close`
      // faz flush do evento antes do exit; timeout curto para nunca travar o
      // shutdown caso o envio para o Sentry esteja lento/indisponível.
      void this.sdk?.close(2000).finally(() => process.exit(1));
    });
    process.on('unhandledRejection', (reason) => this.captureException(reason));

    this.logger.log('Sentry habilitado (SENTRY_DSN configurado)');
  }

  isEnabled(): boolean {
    return this.sdk !== null;
  }

  /**
   * Aplica `redactSensitive` aos trechos de um evento Sentry que podem
   * carregar credenciais (exceção — inclui propriedades extras anexadas a
   * Error, já cobertas por `redact.ts` —, `extra`, `request` e `contexts`).
   * Escopo deliberadamente pontual: preserva o restante do evento (tags,
   * breadcrumbs, sdk, level, timestamps) intacto em vez de redigir a
   * estrutura inteira, que tem profundidade/forma imprevisível.
   */
  static scrubEvent<T extends SentryNode.Event>(event: T): T {
    if (event.exception) {
      event.exception = redactSensitive(event.exception);
    }
    if (event.extra) {
      event.extra = redactSensitive(event.extra);
    }
    if (event.request) {
      event.request = redactSensitive(event.request);
    }
    if (event.contexts) {
      event.contexts = redactSensitive(event.contexts);
    }
    return event;
  }

  captureException(exception: unknown): void {
    if (!this.sdk) {
      return;
    }
    this.sdk.captureException(exception);
  }
}
