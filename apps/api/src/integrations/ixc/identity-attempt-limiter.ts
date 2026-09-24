import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

export interface IdentityAttemptState {
  locked: boolean;
  attemptsRemaining: number;
  retryAfterSeconds: number | null;
}

// Três falhas consecutivas já são suficientes para interromper uma tentativa
// que não está se confirmando. A conversa continua disponível para orientação
// geral, mas a consulta protegida fica temporariamente pausada.
const MAX_ATTEMPTS = 3;
const STATE_TTL_SECONDS = 24 * 60 * 60;
const LOCK_SECONDS = [15 * 60, 30 * 60, 60 * 60] as const;
const CHALLENGE_TTL_SECONDS = 10 * 60;
const VERIFIED_CUSTOMER_TTL_SECONDS = 30 * 60;

@Injectable()
export class IdentityAttemptLimiter {
  constructor(private readonly redis: RedisService) {}

  async status(orgId: string, contactId: string, conversationId: string): Promise<IdentityAttemptState> {
    try {
      const raw = await this.redis.client.get(this.key(orgId, contactId, conversationId));
      const state = this.parse(raw);
      const now = Date.now();
      if (state.lockedUntil > now) {
        return {
          locked: true,
          attemptsRemaining: 0,
          retryAfterSeconds: Math.ceil((state.lockedUntil - now) / 1_000),
        };
      }
      return { locked: false, attemptsRemaining: MAX_ATTEMPTS - state.failures, retryAfterSeconds: null };
    } catch {
      throw new ServiceUnavailableException('Validação de identidade temporariamente indisponível');
    }
  }

  async failure(orgId: string, contactId: string, conversationId: string): Promise<IdentityAttemptState> {
    const key = this.key(orgId, contactId, conversationId);
    const now = Date.now();
    const script = `
      local raw = redis.call('GET', KEYS[1])
      local failures = 0
      local level = 0
      local lockedUntil = 0
      if raw then
        local value = cjson.decode(raw)
        failures = tonumber(value.failures) or 0
        level = tonumber(value.level) or 0
        lockedUntil = tonumber(value.lockedUntil) or 0
      end
      if lockedUntil > tonumber(ARGV[1]) then
        return {failures, level, lockedUntil}
      end
      failures = failures + 1
      if failures >= tonumber(ARGV[2]) then
        level = level + 1
        failures = 0
        local index = math.min(level, 3)
        lockedUntil = tonumber(ARGV[1]) + tonumber(ARGV[2 + index]) * 1000
      else
        lockedUntil = 0
      end
      redis.call('SET', KEYS[1], cjson.encode({failures=failures, level=level, lockedUntil=lockedUntil}), 'EX', ARGV[6])
      return {failures, level, lockedUntil}
    `;
    try {
      const result = (await this.redis.client.eval(
        script,
        1,
        key,
        String(now),
        String(MAX_ATTEMPTS),
        ...LOCK_SECONDS.map(String),
        String(STATE_TTL_SECONDS),
      )) as [number, number, number];
      const failures = Number(result[0]);
      const lockedUntil = Number(result[2]);
      return lockedUntil > now
        ? { locked: true, attemptsRemaining: 0, retryAfterSeconds: Math.ceil((lockedUntil - now) / 1_000) }
        : { locked: false, attemptsRemaining: MAX_ATTEMPTS - failures, retryAfterSeconds: null };
    } catch {
      throw new ServiceUnavailableException('Validação de identidade temporariamente indisponível');
    }
  }

  async success(
    orgId: string,
    contactId: string,
    conversationId: string,
    customerId: string,
  ): Promise<void> {
    try {
      await this.redis.client
        .multi()
        .del(this.key(orgId, contactId, conversationId))
        .set(
          this.verifiedCustomerKey(orgId, contactId, conversationId),
          customerId,
          'EX',
          VERIFIED_CUSTOMER_TTL_SECONDS,
        )
        .exec();
    } catch {
      throw new ServiceUnavailableException('Validação de identidade temporariamente indisponível');
    }
  }

  async verifiedCustomerId(orgId: string, contactId: string, conversationId: string): Promise<string | null> {
    try {
      return await this.redis.client.get(this.verifiedCustomerKey(orgId, contactId, conversationId));
    } catch {
      throw new ServiceUnavailableException('Validação de identidade temporariamente indisponível');
    }
  }

  async clearVerifiedCustomer(orgId: string, contactId: string, conversationId: string): Promise<void> {
    try {
      await this.redis.client.del(this.verifiedCustomerKey(orgId, contactId, conversationId));
    } catch {
      throw new ServiceUnavailableException('Validação de identidade temporariamente indisponível');
    }
  }

  async unlock(orgId: string, contactId: string, conversationId: string): Promise<void> {
    await this.remove(orgId, contactId, conversationId);
  }

  async startChallenge(orgId: string, contactId: string, conversationId: string): Promise<boolean> {
    try {
      const created = await this.redis.client.set(
        this.challengeKey(orgId, contactId, conversationId),
        'pending',
        'EX',
        CHALLENGE_TTL_SECONDS,
        'NX',
      );
      return created === 'OK';
    } catch {
      throw new ServiceUnavailableException('Validação de identidade temporariamente indisponível');
    }
  }

  async challengePending(orgId: string, contactId: string, conversationId: string): Promise<boolean> {
    try {
      return (await this.redis.client.get(this.challengeKey(orgId, contactId, conversationId))) === 'pending';
    } catch {
      throw new ServiceUnavailableException('Validação de identidade temporariamente indisponível');
    }
  }

  async finishChallenge(orgId: string, contactId: string, conversationId: string): Promise<void> {
    try {
      await this.redis.client.del(this.challengeKey(orgId, contactId, conversationId));
    } catch {
      throw new ServiceUnavailableException('Validação de identidade temporariamente indisponível');
    }
  }

  private async remove(orgId: string, contactId: string, conversationId: string): Promise<void> {
    try {
      await this.redis.client.del(this.key(orgId, contactId, conversationId));
    } catch {
      throw new ServiceUnavailableException('Validação de identidade temporariamente indisponível');
    }
  }

  private parse(raw: string | null): { failures: number; level: number; lockedUntil: number } {
    if (!raw) return { failures: 0, level: 0, lockedUntil: 0 };
    try {
      const value = JSON.parse(raw) as Record<string, unknown>;
      return {
        failures: Math.max(0, Number(value.failures) || 0),
        level: Math.max(0, Number(value.level) || 0),
        lockedUntil: Math.max(0, Number(value.lockedUntil) || 0),
      };
    } catch {
      return { failures: 0, level: 0, lockedUntil: 0 };
    }
  }

  private key(orgId: string, contactId: string, conversationId: string): string {
    return `identity-attempt:${orgId}:${contactId}:${conversationId}`;
  }

  private challengeKey(orgId: string, contactId: string, conversationId: string): string {
    return `identity-challenge:${orgId}:${contactId}:${conversationId}`;
  }

  private verifiedCustomerKey(orgId: string, contactId: string, conversationId: string): string {
    return `identity-verified-customer:${orgId}:${contactId}:${conversationId}`;
  }
}
