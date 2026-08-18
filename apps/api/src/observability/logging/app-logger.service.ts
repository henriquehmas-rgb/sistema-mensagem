import { Injectable, type LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pino, { type Logger as PinoLogger } from 'pino';
import type { Env } from '../../config/env.validation';
import { TenancyService } from '../../tenancy/tenancy.service';
import { redactSensitive } from './redact';

/**
 * Logger estruturado da api (CONTRACTS §14): pino direto (sem nestjs-pino —
 * menos dependências, evita a fricção de propagar contexto de request via
 * pino-http/AsyncLocalStorage). Registrado globalmente via `app.useLogger()`
 * em main.ts: TODAS as instâncias `new Logger(Ctx)` espalhadas pelo código
 * passam a escrever aqui (mecanismo padrão do Nest — não exige tocar nos
 * call sites existentes).
 *
 * - Produção (NODE_ENV=production): JSON em stdout.
 * - Dev/test: texto legível (pino-pretty em dev; test fica em JSON simples
 *   para não subir worker threads de transporte durante a suíte).
 * - orgId/userId: lidos do TenancyService (AsyncLocalStorage) a cada chamada
 *   de log — funciona porque o contexto do tenant está ativo durante toda a
 *   cadeia assíncrona do request (TenancyInterceptor), então qualquer log
 *   emitido a partir de um service/processor durante o processamento de uma
 *   requisição autenticada já sai com esses campos via `pino.child()`.
 * - Redação: mensagens/parâmetros extra que sejam objetos passam por
 *   `redactSensitive` antes de chegar ao pino (accessToken/password/
 *   authorization nunca aparecem em log, CONTRACTS §14).
 */
@Injectable()
export class AppLogger implements LoggerService {
  private readonly root: PinoLogger;

  constructor(
    config: ConfigService<Env, true>,
    private readonly tenancy: TenancyService,
  ) {
    this.root = AppLogger.createRootLogger(config.get('NODE_ENV', { infer: true }));
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.write('info', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.write('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.write('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.write('trace', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.write('fatal', message, optionalParams);
  }

  /**
   * Constrói o logger raiz pino. Exposto estático apenas para ser testável
   * sem precisar de DI (ConfigService/TenancyService reais).
   */
  static createRootLogger(nodeEnv: string): PinoLogger {
    const level = process.env.LOG_LEVEL ?? (nodeEnv === 'production' ? 'info' : 'debug');

    if (nodeEnv === 'development') {
      // pino-pretty é devDependency (não vai para a imagem de produção) —
      // NODE_ENV=production nunca cai aqui, então isso é seguro.
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require.resolve('pino-pretty');
        return pino({
          level,
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
          },
        });
      } catch {
        // pino-pretty ausente (ex.: instalação --prod local) — cai no JSON puro.
      }
    }

    return pino({ level });
  }

  /**
   * Nest injeta o `context` (nome da classe) como o ÚLTIMO parâmetro extra
   * em `log`/`warn`/`debug`/`verbose` (ver @nestjs/common Logger#log). Em
   * `error`, quando há stack trace, ela vem ANTES do context — por isso só
   * tratamos o último item como context quando é string; o restante vira
   * `extra` (redigido) na linha de log.
   */
  private write(
    level: 'info' | 'warn' | 'error' | 'debug' | 'trace' | 'fatal',
    message: unknown,
    optionalParams: unknown[],
  ): void {
    const params = [...optionalParams];
    const context =
      params.length > 0 && typeof params.at(-1) === 'string' ? (params.pop() as string) : undefined;

    const tenant = this.tenancy.getContext();
    const bindings: Record<string, unknown> = {};
    if (context) {
      bindings.context = context;
    }
    if (tenant?.orgId) {
      bindings.orgId = tenant.orgId;
    }
    if (tenant?.userId) {
      bindings.userId = tenant.userId;
    }

    const logger = Object.keys(bindings).length > 0 ? this.root.child(bindings) : this.root;
    const extra = params.length > 0 ? redactSensitive(params.length === 1 ? params[0] : params) : undefined;

    if (message instanceof Error) {
      // Caso especial obrigatório: `BaseExceptionFilter`/`SentryExceptionFilter`
      // do Nest chamam `logger.error(exception)` para TODA exceção HTTP não
      // tratada (todo 500), e processors BullMQ também logam Error direto.
      // `JSON.stringify(new Error(...))` produz '{}' (message/stack não são
      // enumeráveis) — perderia a informação inteira do erro. `redactSensitive`
      // já converte o Error num objeto plano {name, message, stack, ...extras
      // redigidos}; usamos o stack (ou message) como texto legível da linha de
      // log e o objeto completo (já redigido) como payload estruturado.
      const safeError = redactSensitive(message) as { name: string; message: string; stack?: string };
      const text = safeError.stack ?? safeError.message ?? safeError.name ?? 'Error';
      const payload = extra !== undefined ? { err: safeError, extra } : { err: safeError };
      logger[level](payload, text);
      return;
    }

    const safeMessage = redactSensitive(message);
    const text = typeof safeMessage === 'string' ? safeMessage : JSON.stringify(safeMessage);
    if (extra !== undefined) {
      logger[level]({ extra }, text);
    } else {
      logger[level](text);
    }
  }
}
