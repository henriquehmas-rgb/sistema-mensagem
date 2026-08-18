import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * Interceptor global (CONTRACTS §14): conta/mede a duração de TODA requisição
 * HTTP que chega a um handler do Nest, por rota/método/status.
 *
 * Mede via o evento `finish` do Response (Express) em vez de ler
 * `response.statusCode` dentro dos operadores RxJS: no momento em que o
 * handler lança uma exceção, o Observable emite o erro ANTES do filtro de
 * exceção escrever a resposta final — `res.statusCode` ainda não reflete o
 * status HTTP definitivo naquele ponto. `finish` só dispara depois que a
 * resposta (sucesso OU erro tratado pelo ExceptionsHandler) foi
 * completamente enviada, garantindo o status_code correto em ambos os casos.
 */
@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<Request>();
    const response = httpContext.getResponse<Response>();
    const start = process.hrtime.bigint();
    const route = this.resolveRoute(request);

    response.once('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
      this.metrics.recordHttpRequest(request.method, route, response.statusCode, durationSeconds);
    });

    return next.handle();
  }

  /**
   * Padrão de rota registrado no Express (com `:params`), não a URL crua —
   * evita explosão de séries temporais por cardinalidade de ids/telefones.
   * `req.route` já está populado neste ponto: o Express só invoca o handler
   * do Nest (guards→interceptors→controller) DEPOIS de casar a rota.
   */
  private resolveRoute(request: Request): string {
    const route = (request as Request & { route?: { path?: string } }).route;
    if (route?.path) {
      return `${request.baseUrl ?? ''}${route.path}`;
    }
    return request.path;
  }
}
