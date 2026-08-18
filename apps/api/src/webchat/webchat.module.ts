import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.validation';
import { InboundModule } from '../inbound/inbound.module';
import { MediaModule } from '../media/media.module';
import { QueueModule } from '../queues/queue.module';
import { WebchatController } from './webchat.controller';
import { WebchatGateway } from './webchat.gateway';
import { WebchatService } from './webchat.service';
import { WebchatUploadGuard } from './webchat-upload.guard';

/**
 * Webchat público (CONTRACTS §6): sessão de visitante, envio/polling de
 * mensagens e namespace socket /webchat. O visitorToken é assinado com o
 * JWT_SECRET mas carrega scope 'webchat' — JwtStrategy e o /rt o rejeitam.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
      }),
    }),
    QueueModule,
    InboundModule,
    MediaModule,
  ],
  controllers: [WebchatController],
  providers: [WebchatService, WebchatGateway, WebchatUploadGuard],
})
export class WebchatModule {}
