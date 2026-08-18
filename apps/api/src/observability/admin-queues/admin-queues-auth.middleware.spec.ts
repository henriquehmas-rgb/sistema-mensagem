import type { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { UserStatusService } from '../../auth/user-status.service';
import { createAdminQueuesAuthMiddleware } from './admin-queues-auth.middleware';

/**
 * /admin/queues é montado via `app.use()` cru (fora do router do Nest) — os
 * guards globais (JwtAuthGuard/RolesGuard) NÃO cobrem essa rota, então este
 * middleware é a ÚNICA proteção real. Ponto mais arriscado da tarefa
 * (CONTRACTS §14) — coberto com o mesmo rigor do guard de métricas.
 */
function createResponse(): Response {
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  (res.status as ReturnType<typeof vi.fn>).mockReturnValue(res);
  return res;
}

function createRequest(authorization?: string): Request {
  return { headers: { authorization } } as unknown as Request;
}

describe('createAdminQueuesAuthMiddleware', () => {
  it('sem header Authorization → 401, next() não chamado', async () => {
    const jwtService = { verifyAsync: vi.fn() } as unknown as JwtService;
    const userStatus = { isActive: vi.fn() } as unknown as UserStatusService;
    const middleware = createAdminQueuesAuthMiddleware(jwtService, userStatus);
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    middleware(createRequest(undefined), res, next);
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(401));
    expect(next).not.toHaveBeenCalled();
  });

  it('token inválido/expirado (verifyAsync lança) → 401', async () => {
    const jwtService = {
      verifyAsync: vi.fn().mockRejectedValue(new Error('jwt expired')),
    } as unknown as JwtService;
    const userStatus = { isActive: vi.fn() } as unknown as UserStatusService;
    const middleware = createAdminQueuesAuthMiddleware(jwtService, userStatus);
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    middleware(createRequest('Bearer token-invalido'), res, next);
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(401));
    expect(next).not.toHaveBeenCalled();
  });

  it('token de escopo restrito (visitorToken do webchat) → 401', async () => {
    const jwtService = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'u1', scope: 'webchat', orgId: 'org1' }),
    } as unknown as JwtService;
    const userStatus = { isActive: vi.fn() } as unknown as UserStatusService;
    const middleware = createAdminQueuesAuthMiddleware(jwtService, userStatus);
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    middleware(createRequest('Bearer scoped-token'), res, next);
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(401));
    expect(next).not.toHaveBeenCalled();
  });

  it('usuário desativado → 401', async () => {
    const jwtService = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'u1', role: 'ADMIN', orgId: 'org1' }),
    } as unknown as JwtService;
    const userStatus = { isActive: vi.fn().mockResolvedValue(false) } as unknown as UserStatusService;
    const middleware = createAdminQueuesAuthMiddleware(jwtService, userStatus);
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    middleware(createRequest('Bearer token-valido'), res, next);
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(401));
    expect(next).not.toHaveBeenCalled();
  });

  it('usuário autenticado mas sem role ADMIN → 403', async () => {
    const jwtService = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'u1', role: 'AGENT', orgId: 'org1' }),
    } as unknown as JwtService;
    const userStatus = { isActive: vi.fn().mockResolvedValue(true) } as unknown as UserStatusService;
    const middleware = createAdminQueuesAuthMiddleware(jwtService, userStatus);
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    middleware(createRequest('Bearer token-agente'), res, next);
    await vi.waitFor(() => expect(res.status).toHaveBeenCalledWith(403));
    expect(next).not.toHaveBeenCalled();
  });

  it('ADMIN ativo com token válido → next() chamado, sem resposta de erro', async () => {
    const jwtService = {
      verifyAsync: vi.fn().mockResolvedValue({ sub: 'u1', role: 'ADMIN', orgId: 'org1' }),
    } as unknown as JwtService;
    const userStatus = { isActive: vi.fn().mockResolvedValue(true) } as unknown as UserStatusService;
    const middleware = createAdminQueuesAuthMiddleware(jwtService, userStatus);
    const res = createResponse();
    const next = vi.fn() as NextFunction;

    middleware(createRequest('Bearer token-admin'), res, next);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(res.status).not.toHaveBeenCalled();
  });
});
