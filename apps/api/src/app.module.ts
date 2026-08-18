import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AutomationsModule } from './automations/automations.module';
import { ChannelsModule } from './channels/channels.module';
import { validateEnv, type Env } from './config/env.validation';
import { ContactsModule } from './contacts/contacts.module';
import { ConversationsModule } from './conversations/conversations.module';
import { CryptoModule } from './crypto/crypto.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HealthModule } from './health/health.module';
import { InboundModule } from './inbound/inbound.module';
import { KnowledgeModule } from './knowledge/knowledge.module';
import { MediaModule } from './media/media.module';
import { MessagesModule } from './messages/messages.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queues/queue.module';
import { RealtimeModule } from './realtime/realtime.module';
import { RedisModule } from './redis/redis.module';
import { StagesModule } from './stages/stages.module';
import { TagsModule } from './tags/tags.module';
import { TenancyInterceptor } from './tenancy/tenancy.interceptor';
import { TenancyModule } from './tenancy/tenancy.module';
import { UsersModule } from './users/users.module';
import { WebchatModule } from './webchat/webchat.module';
import { WebhooksModule } from './webhooks/webhooks.module';

function parseRedisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || '6379'),
    username: url.username || undefined,
    password: url.password || undefined,
    db: url.pathname && url.pathname !== '/' ? Number(url.pathname.slice(1)) : 0,
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env', '../../.env'],
    }),
    // CONTRACTS §9: default 120/min; auth 5/min via @Throttle; webhooks/health com @SkipThrottle
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 120 }],
    }),
    // CONTRACTS §4: filas BullMQ prefixo `sm`, attempts 3, backoff exponencial
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        prefix: 'sm',
        connection: parseRedisConnection(config.get('REDIS_URL', { infer: true })),
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1_000 },
          removeOnComplete: { count: 1_000 },
        },
      }),
    }),
    TenancyModule,
    PrismaModule,
    RedisModule,
    CryptoModule,
    AuditModule,
    RealtimeModule,
    QueueModule,
    AuthModule,
    HealthModule,
    UsersModule,
    ContactsModule,
    ConversationsModule,
    MessagesModule,
    StagesModule,
    TagsModule,
    DashboardModule,
    KnowledgeModule,
    MediaModule,
    ChannelsModule,
    InboundModule,
    WebhooksModule,
    WebchatModule,
    AutomationsModule,
  ],
  providers: [
    // Ordem importa: throttle → autenticação → RBAC; depois interceptor popula tenant
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TenancyInterceptor },
  ],
})
export class AppModule {}
