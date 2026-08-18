import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { WebchatService, type WebchatTokenPayload } from './webchat.service';

export interface RequestWithWebchatToken extends Request {
  webchatToken?: WebchatTokenPayload;
}

/**
 * Guard de POST /api/webchat/uploads (CONTRACTS §13 — correção de revisão):
 * valida o visitorToken ANTES do `FileInterceptor` rodar. Guards do Nest SEMPRE
 * executam antes de Interceptors no pipeline da requisição (Middleware → Guards
 * → Interceptors → Pipes → Handler) — então um Bearer ausente/inválido é
 * rejeitado aqui (401) sem que o multer chegue a bufferizar até 20MB em
 * memória, fechando o vetor onde um token qualquer/expirado pagava o custo
 * total do parse multipart antes do 401 (amplificação de negação de serviço
 * sem credencial válida).
 * Anexa o payload verificado em `request.webchatToken` (não usado pelo
 * controller hoje — WebchatService.uploadMedia reverifica por conta própria,
 * custo desprezível — mas fica disponível caso o controller queira evitar a
 * dupla verificação no futuro).
 */
@Injectable()
export class WebchatUploadGuard implements CanActivate {
  constructor(private readonly webchatService: WebchatService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithWebchatToken>();
    const authorization = request.headers.authorization;
    const token =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length).trim()
        : '';
    // Lança UnauthorizedException em token ausente/inválido/expirado — a
    // exceção se propaga normalmente pelos exception filters do Nest (401),
    // sem nunca chegar ao FileInterceptor.
    request.webchatToken = await this.webchatService.verifyToken(token);
    return true;
  }
}
