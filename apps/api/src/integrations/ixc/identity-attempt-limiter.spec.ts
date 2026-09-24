import { describe, expect, it, vi } from 'vitest';
import { IdentityAttemptLimiter } from './identity-attempt-limiter';

describe('IdentityAttemptLimiter', () => {
  it('falha fechada quando o Redis está indisponível', async () => {
    const redis = { client: { get: vi.fn().mockRejectedValue(new Error('offline')) } };
    const limiter = new IdentityAttemptLimiter(redis as never);
    await expect(limiter.status('org', 'contact', 'conversation')).rejects.toThrow(
      'Validação de identidade temporariamente indisponível',
    );
  });

  it('não armazena os fatores informados na chave de controle', async () => {
    const redis = { client: { get: vi.fn().mockResolvedValue(null) } };
    const limiter = new IdentityAttemptLimiter(redis as never);
    await limiter.status('org_1', 'contact_1', 'conversation_1');
    expect(redis.client.get).toHaveBeenCalledWith('identity-attempt:org_1:contact_1:conversation_1');
  });

  it('remove o estado e vincula temporariamente o cliente após sucesso', async () => {
    const chain = {
      del: vi.fn(),
      set: vi.fn(),
      exec: vi.fn().mockResolvedValue([]),
    };
    chain.del.mockReturnValue(chain);
    chain.set.mockReturnValue(chain);
    const redis = { client: { multi: vi.fn().mockReturnValue(chain) } };
    const limiter = new IdentityAttemptLimiter(redis as never);
    await limiter.success('org_1', 'contact_1', 'conversation_1', 'customer_10');
    expect(chain.del).toHaveBeenCalledWith('identity-attempt:org_1:contact_1:conversation_1');
    expect(chain.set).toHaveBeenCalledWith(
      'identity-verified-customer:org_1:contact_1:conversation_1',
      'customer_10', 'EX', 1800,
    );
  });

  it('mantém bloqueio retornado pela operação atômica e não cria uma quarta tentativa', async () => {
    const lockedUntil = Date.now() + 15 * 60 * 1_000;
    const redis = { client: { eval: vi.fn().mockResolvedValue([0, 1, lockedUntil]) } };
    const limiter = new IdentityAttemptLimiter(redis as never);
    const result = await limiter.failure('org', 'contact', 'conversation');
    expect(result.locked).toBe(true);
    expect(result.attemptsRemaining).toBe(0);
    expect(result.retryAfterSeconds).toBeGreaterThan(890);
    expect(redis.client.eval).toHaveBeenCalledTimes(1);
  });

  it('isola o controle por empresa, contato e conversa', async () => {
    const redis = { client: { get: vi.fn().mockResolvedValue(null) } };
    const limiter = new IdentityAttemptLimiter(redis as never);
    await Promise.all([
      limiter.status('org_a', 'contact', 'conversation'),
      limiter.status('org_b', 'contact', 'conversation'),
      limiter.status('org_a', 'other_contact', 'conversation'),
    ]);
    expect(redis.client.get.mock.calls.map(([key]) => key)).toEqual([
      'identity-attempt:org_a:contact:conversation',
      'identity-attempt:org_b:contact:conversation',
      'identity-attempt:org_a:other_contact:conversation',
    ]);
  });

  it('cria o desafio temporário sem armazenar resposta pessoal', async () => {
    const redis = { client: { set: vi.fn().mockResolvedValue('OK') } };
    const limiter = new IdentityAttemptLimiter(redis as never);
    await limiter.startChallenge('org', 'contact', 'conversation');
    expect(redis.client.set).toHaveBeenCalledWith(
      'identity-challenge:org:contact:conversation', 'pending', 'EX', 600, 'NX',
    );
  });
});
