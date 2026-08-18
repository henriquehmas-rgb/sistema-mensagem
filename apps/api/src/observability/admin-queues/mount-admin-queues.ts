import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bullmq';
import { Logger, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Queue } from 'bullmq';
import type { Express } from 'express';
import { UserStatusService } from '../../auth/user-status.service';
import { QUEUES } from '../../queues/queues.constants';
import { createAdminQueuesAuthMiddleware } from './admin-queues-auth.middleware';

/** Caminho público final: prefixo global 'api' (main.ts) + 'admin/queues'. */
export const ADMIN_QUEUES_PATH = '/api/admin/queues';

/**
 * Monta o Bull Board em /admin/queues (CONTRACTS §14).
 *
 * DECISÃO DE INTEGRAÇÃO (documentada aqui por ser o ponto mais arriscado da
 * tarefa): o pacote oficial `@bull-board/express` espera ser montado com
 * `app.use(basePath, router)` — o próprio Express reescreve `req.url`/
 * `req.baseUrl` relativo ao ponto de montagem, e é disso que as rotas
 * internas do painel (assets estáticos, API JSON) dependem para casar.
 * Replicar esse comportamento "à mão" dentro de um controller do Nest
 * (ex.: `@All('*')` encaminhando para `router(req,res,next)`) exigiria
 * reimplementar manualmente essa reescrita de URL — frágil e desnecessário.
 * Por isso o board é montado via `app.use()` DIRETO no Express subjacente
 * (após `NestFactory.create`), como o próprio CONTRACTS §14 antecipa.
 *
 * CONSEQUÊNCIA TESTADA: guards globais do Nest (APP_GUARD — JwtAuthGuard,
 * RolesGuard) só executam para requisições roteadas pelo PRÓPRIO Nest; uma
 * rota montada com `app.use()` cru nunca passa pelo pipeline de guards do
 * Nest, então NÃO ficaria protegida por eles. Por isso aplicamos
 * `createAdminQueuesAuthMiddleware` (mesma verificação de JwtAuthGuard +
 * RolesGuard('ADMIN')) IMEDIATAMENTE ANTES do router do Bull Board.
 */
export function mountAdminQueues(app: INestApplication): void {
  const jwtService = app.get(JwtService, { strict: false });
  const userStatus = app.get(UserStatusService, { strict: false });

  const queues = Object.values(QUEUES).map((name) =>
    app.get<Queue>(getQueueToken(name), { strict: false }),
  );

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(ADMIN_QUEUES_PATH);
  createBullBoard({
    queues: queues.map((queue) => new BullMQAdapter(queue)),
    serverAdapter,
  });

  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.use(
    ADMIN_QUEUES_PATH,
    createAdminQueuesAuthMiddleware(jwtService, userStatus),
    serverAdapter.getRouter(),
  );

  Logger.log(`Bull Board montado em ${ADMIN_QUEUES_PATH} (ADMIN only)`, 'Bootstrap');
}
