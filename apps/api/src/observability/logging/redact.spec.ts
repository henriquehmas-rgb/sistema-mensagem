import { describe, expect, it } from 'vitest';
import { redactSensitive } from './redact';

/**
 * CONTRACTS §14: nenhuma credencial/PII em log — accessToken/password/
 * authorization SEMPRE mascarados em qualquer log de objeto.
 */
describe('redactSensitive', () => {
  it('mascara accessToken/password/authorization no primeiro nível', () => {
    const input = {
      accessToken: 'abc123',
      password: 'hunter2',
      authorization: 'Bearer xyz',
      name: 'ok',
    };
    expect(redactSensitive(input)).toEqual({
      accessToken: '[REDACTED]',
      password: '[REDACTED]',
      authorization: '[REDACTED]',
      name: 'ok',
    });
  });

  it('é case-insensitive na chave (Authorization, AccessToken, PASSWORD)', () => {
    const input = { AccessToken: 'x', PASSWORD: 'y', Authorization: 'z', Name: 'ok' };
    expect(redactSensitive(input)).toEqual({
      AccessToken: '[REDACTED]',
      PASSWORD: '[REDACTED]',
      Authorization: '[REDACTED]',
      Name: 'ok',
    });
  });

  it('mascara em profundidade — objetos aninhados e arrays', () => {
    const input = {
      channel: { config: { name: 'wa' }, encryptedCredentials: 'unused-field-name-here' },
      credentials: { accessToken: 'deep-secret' },
      list: [{ password: 'p1' }, { password: 'p2', ok: true }],
    };
    expect(redactSensitive(input)).toEqual({
      channel: { config: { name: 'wa' }, encryptedCredentials: '[REDACTED]' },
      credentials: { accessToken: '[REDACTED]' },
      list: [{ password: '[REDACTED]' }, { password: '[REDACTED]', ok: true }],
    });
  });

  it('não mexe em campos não sensíveis', () => {
    const input = { orgId: 'org1', userId: 'user1', count: 3, active: true };
    expect(redactSensitive(input)).toEqual(input);
  });

  it('primitivos e null/undefined passam direto (sem lançar)', () => {
    expect(redactSensitive('hello')).toBe('hello');
    expect(redactSensitive(42)).toBe(42);
    expect(redactSensitive(true)).toBe(true);
    expect(redactSensitive(null)).toBe(null);
    expect(redactSensitive(undefined)).toBe(undefined);
  });

  it('protege contra referência circular (nunca deve lançar/travar)', () => {
    const obj: Record<string, unknown> = { accessToken: 'secret' };
    obj.self = obj;
    const result = redactSensitive(obj) as Record<string, unknown>;
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.self).toBe('[CIRCULAR]');
  });

  it('Date passa intacta (não vira "[OBJECT]")', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const result = redactSensitive({ date }) as { date: Date };
    expect(result.date).toBe(date);
  });

  it('Error "limpa" (sem props extras) preserva name/message/stack', () => {
    const error = new Error('falha ao processar');
    const result = redactSensitive({ error }) as {
      error: { name: string; message: string; stack?: string };
    };
    expect(result.error.name).toBe('Error');
    expect(result.error.message).toBe('falha ao processar');
    expect(result.error.stack).toBe(error.stack);
  });

  it('mascara propriedades sensíveis anexadas a um Error (ex.: cliente HTTP de terceiros ou Object.assign)', () => {
    // Padrão comum: bibliotecas HTTP anexam config/headers ao erro, ou código
    // customizado faz Object.assign(new Error(...), { accessToken, ... }).
    // Essas propriedades são enumeráveis (diferente de message/stack) e
    // PRECISAM ser redigidas — ao contrário de message/stack, que não são
    // enumeráveis e por isso não apareceriam via Object.entries ingênuo.
    const error = Object.assign(new Error('request failed'), {
      config: { headers: { authorization: 'Bearer super-secret-meta-token' } },
      accessToken: 'plain-secret-token',
    });
    const result = redactSensitive({ error }) as {
      error: {
        message: string;
        config: { headers: { authorization: string } };
        accessToken: string;
      };
    };
    expect(result.error.message).toBe('request failed');
    expect(result.error.config.headers.authorization).toBe('[REDACTED]');
    expect(result.error.accessToken).toBe('[REDACTED]');
  });
});
