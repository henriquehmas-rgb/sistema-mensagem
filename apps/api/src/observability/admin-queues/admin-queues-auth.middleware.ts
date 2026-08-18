import { Logger } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { NextFunction, Request, Response } from 'express';
import type { JwtAccessPayload } from '../../auth/interfaces/auth-user.interface';
import type { UserStatusService } from '../../auth/user-status.service';

const logger = new Logger('AdminQueuesAuth');

/**
 * Autenticação/autorização de /admin/queues (CONTRACTS §14) — EQUIVALENTE ao
 * par JwtAuthGuard+RolesGuard('ADMIN') globais, mas reimplementada aqui de
 * propósito: o Bull Board é montado com `app.use()` DIRETO no Express
 * subjacente (ver mount-admin-queues.ts), fora do router do Nest — guards
 * globais registrados via APP_GUARD só rodam para requisições que o Nest
 * efetivamente roteia a um controller/handler seu. Uma rota montada com
 * `app.use()` cru nunca passa por ali, então sem este middleware o painel
 * ficaria TOTALMENTE aberto. Mesma verificação do JwtStrategy: token válido,
 * sem `scope` restrito (visitorToken do webchat não vale aqui), usuário
 * ativo (UserStatusService) e role === ADMIN.
 */
export function createAdminQueuesAuthMiddleware(
  jwtService: JwtService,
  userStatus: UserStatusService,
) {
  return function adminQueuesAuth(req: Request, res: Response, next: NextFunction): void {
    void (async () => {
      try {
        const header = req.headers.authorization;
        if (!header || !header.startsWith('Bearer ')) {
          res.status(401).json({ statusCode: 401, message: 'Token ausente', error: 'Unauthorized' });
          return;
        }

        const token = header.slice('Bearer '.length).trim();
        const payload = await jwtService.verifyAsync<JwtAccessPayload & { scope?: string }>(token);

        if (payload.scope !== undefined || !payload.role || !payload.orgId) {
          res
            .status(401)
            .json({ statusCode: 401, message: 'Token sem escopo de acesso à API', error: 'Unauthorized' });
          return;
        }
        if (!(await userStatus.isActive(payload.sub))) {
          res.status(401).json({ statusCode: 401, message: 'Usuário desativado', error: 'Unauthorized' });
          return;
        }
        if (payload.role !== 'ADMIN') {
          res.status(403).json({
            statusCode: 403,
            message: 'Permissão insuficiente para esta operação',
            error: 'Forbidden',
          });
          return;
        }

        next();
      } catch (error) {
        logger.warn(`Acesso negado a /admin/queues: ${(error as Error).message}`);
        res
          .status(401)
          .json({ statusCode: 401, message: 'Token inválido ou expirado', error: 'Unauthorized' });
      }
    })();
  };
}
