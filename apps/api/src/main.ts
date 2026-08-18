import { Logger, ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { Env } from './config/env.validation';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

async function bootstrap(): Promise<void> {
  // rawBody: necessário para validar X-Hub-Signature-256 dos webhooks Meta (HMAC do corpo cru)
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get<ConfigService<Env, true>>(ConfigService);

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

  // Graceful shutdown (SIGTERM/SIGINT): fecha HTTP, Prisma e Redis via lifecycle hooks
  app.enableShutdownHooks();

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`API SEEG Omni ouvindo em http://localhost:${port}/api`, 'Bootstrap');
}

void bootstrap();
