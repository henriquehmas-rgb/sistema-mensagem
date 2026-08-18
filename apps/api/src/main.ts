import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';
import { mountAdminQueues } from './observability/admin-queues/mount-admin-queues';
import { AppLogger } from './observability/logging/app-logger.service';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  // rawBody: necessário para validar X-Hub-Signature-256 dos webhooks Meta (HMAC do corpo cru)
  // bufferLogs: segura os logs internos do Nest (mensagens de boot dos módulos)
  // até `app.useLogger()` abaixo trocar para o AppLogger (pino) — nada se perde.
  const app = await NestFactory.create(AppModule, { rawBody: true, bufferLogs: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // CONTRACTS §14: logs estruturados (JSON em produção, pretty em dev) —
  // substitui o logger padrão do Nest globalmente. Depois desta linha, TODA
  // instância `new Logger(Ctx)` do código (guards/services/processors)
  // passa a escrever aqui automaticamente (mecanismo padrão do Nest).
  app.useLogger(app.get(AppLogger));

  app.use(helmet());
  app.enableCors({
    origin: config.get('PUBLIC_URL', { infer: true }),
    credentials: true,
  });

  // Socket.io (namespace /rt, path /socket.io) com Redis adapter — CONTRACTS §5
  const redisIoAdapter = new RedisIoAdapter(
    app,
    config.get('REDIS_URL', { infer: true }),
    config.get('PUBLIC_URL', { infer: true }),
  );
  redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // Rotas: /api/v1/** (default) — webhooks e health são VERSION_NEUTRAL (/api/**)
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CONTRACTS §14: Bull Board em /admin/queues — montado via app.use() cru
  // (fora do router do Nest, ver mount-admin-queues.ts) com autenticação
  // equivalente a JwtAuthGuard+RolesGuard('ADMIN') aplicada no próprio middleware.
  mountAdminQueues(app);

  // Graceful shutdown (SIGTERM/SIGINT): fecha HTTP, Prisma e Redis via lifecycle hooks
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`API SEEG Omni ouvindo em http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
