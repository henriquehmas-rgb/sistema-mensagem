import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { Env } from '../config/env.validation';

const PING_TIMEOUT_MS = 2_000;

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService<Env, true>) {
    this.client = new Redis(config.get('REDIS_URL', { infer: true }), {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      connectTimeout: PING_TIMEOUT_MS,
      retryStrategy: (times) => Math.min(times * 500, 5_000),
    });
    // Sem handler, falha de conexão vira unhandled error event e derruba o processo
    this.client.on('error', (error) => {
      this.logger.warn(`Redis: ${error.message}`);
    });
  }

  async ping(): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const attempt = (async () => {
        if (this.client.status === 'wait' || this.client.status === 'end') {
          await this.client.connect();
        }
        return this.client.ping();
      })();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('redis ping timeout')), PING_TIMEOUT_MS);
      });
      const result = await Promise.race([attempt, timeout]);
      return result === 'PONG';
    } catch {
      return false;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
