import 'reflect-metadata';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { WebchatService, WebchatTokenPayload } from './webchat.service';
import { WebchatUploadGuard } from './webchat-upload.guard';

/**
 * WebchatUploadGuard (CONTRACTS §13, correção de revisão): POST
 * /webchat/uploads precisa rejeitar um visitorToken ausente/inválido ANTES do
 * FileInterceptor rodar. Guards do Nest executam antes de Interceptors — este
 * teste cobre só a lógica do guard (o encadeamento real com o interceptor é
 * garantido pelo próprio framework, não é algo que dê pra exercitar num teste
 * unitário sem harness e2e, que este repo não usa).
 */

const TOKEN_PAYLOAD: WebchatTokenPayload = {
  sub: 'contact-1',
  orgId: 'org-1',
  channelId: 'channel-1',
  conversationId: 'conversation-1',
  scope: 'webchat',
};

function contextWithAuthHeader(authorization: string | undefined): {
  context: ExecutionContext;
  request: Record<string, unknown>;
} {
  const request: Record<string, unknown> = { headers: { authorization } };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return { context, request };
}

describe('WebchatUploadGuard', () => {
  it('sem header Authorization → UnauthorizedException, nunca chama verifyToken com token vazio silenciosamente', async () => {
    const verifyToken = vi.fn().mockRejectedValue(new UnauthorizedException('visitorToken ausente'));
    const guard = new WebchatUploadGuard({ verifyToken } as unknown as WebchatService);
    const { context } = contextWithAuthHeader(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifyToken).toHaveBeenCalledExactlyOnceWith('');
  });

  it('header sem prefixo "Bearer " → trata como token vazio', async () => {
    const verifyToken = vi.fn().mockRejectedValue(new UnauthorizedException());
    const guard = new WebchatUploadGuard({ verifyToken } as unknown as WebchatService);
    const { context } = contextWithAuthHeader('token-sem-prefixo');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifyToken).toHaveBeenCalledExactlyOnceWith('');
  });

  it('token inválido/expirado (verifyToken rejeita) → propaga UnauthorizedException', async () => {
    const verifyToken = vi.fn().mockRejectedValue(new UnauthorizedException('visitorToken inválido ou expirado'));
    const guard = new WebchatUploadGuard({ verifyToken } as unknown as WebchatService);
    const { context } = contextWithAuthHeader('Bearer token-invalido');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(verifyToken).toHaveBeenCalledExactlyOnceWith('token-invalido');
  });

  it('token válido → autoriza e anexa o payload verificado em request.webchatToken', async () => {
    const verifyToken = vi.fn().mockResolvedValue(TOKEN_PAYLOAD);
    const guard = new WebchatUploadGuard({ verifyToken } as unknown as WebchatService);
    const { context, request } = contextWithAuthHeader('Bearer token-valido');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.webchatToken).toEqual(TOKEN_PAYLOAD);
  });
});
