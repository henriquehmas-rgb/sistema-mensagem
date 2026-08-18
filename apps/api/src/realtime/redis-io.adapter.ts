import { Logger, type INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import Redis from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';

/**
 * IoAdapter com @socket.io/redis-adapter (CONTRACTS §5): duas conexões ioredis
 * dedicadas (pub/sub) permitem broadcast entre múltiplas instâncias da api.
 * Instalado em main.ts via app.useWebSocketAdapter().
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger(RedisIoAdapter.name);
  private adapterConstructor: ReturnType<typeof createAdapter> | null = null;
  private pubClient: Redis | null = null;
  private subClient: Redis | null = null;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
    private readonly corsOrigin: string,
  ) {
    super(app);
  }

  /**
   * Cria as conexões pub/sub. Não bloqueia o boot se o Redis estiver fora
   * (dev local sem Docker); o ioredis reconecta em background.
   */
  connectToRedis(): void {
    this.pubClient = new Redis(this.redisUrl, {
      retryStrategy: (times) => Math.min(times * 500, 5_000),
    });
    this.subClient = this.pubClient.duplicate();
    for (const [label, client] of [
      ['pub', this.pubClient],
      ['sub', this.subClient],
    ] as const) {
      client.on('error', (error) => {
        this.logger.warn(`Redis adapter (${label}): ${error.message}`);
      });
    }
    this.adapterConstructor = createAdapter(this.pubClient, this.subClient);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      path: '/socket.io',
      cors: { origin: this.corsOrigin, credentials: true },
    }) as Server;
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    } else {
      this.logger.warn('Redis adapter indisponível — Socket.io rodando em memória local');
    }
    return server;
  }

  override async close(server: Server): Promise<void> {
    await super.close(server);
    await Promise.allSettled([
      this.pubClient?.quit() ?? Promise.resolve(),
      this.subClient?.quit() ?? Promise.resolve(),
    ]);
  }
}
