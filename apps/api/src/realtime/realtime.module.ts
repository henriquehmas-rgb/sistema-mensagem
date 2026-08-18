import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import type { Env } from '../config/env.validation';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

/**
 * Realtime (CONTRACTS §5) — global: todos os services de domínio e processors
 * emitem eventos exclusivamente via RealtimeService.
 */
@Global()
@Module({
  imports: [
    // Mesmo segredo do AuthModule — verificação do JWT no handshake do socket.
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_SECRET', { infer: true }),
      }),
    }),
    // UserStatusService — bloqueia handshake de usuário desativado.
    AuthModule,
  ],
  providers: [RealtimeService, RealtimeGateway],
  exports: [RealtimeService],
})
export class RealtimeModule {}
