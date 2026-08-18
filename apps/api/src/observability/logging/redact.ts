/**
 * Redação de campos sensíveis em objetos de log (CONTRACTS §14): nenhuma
 * credencial/PII em log. Função pura (sem I/O) — usada pelo AppLogger antes
 * de qualquer `message`/parâmetro extra estruturado ir para o pino.
 *
 * Cobre — case-insensitive, em qualquer profundidade do objeto:
 *   accessToken, password, authorization (exigidos pelo contrato) + variações
 *   comuns de segredo (refreshToken, encryptedCredentials, apiKey, secret).
 */
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;

const SENSITIVE_KEYS = new Set([
  'accesstoken',
  'access_token',
  'password',
  'authorization',
  'refreshtoken',
  'refresh_token',
  'encryptedcredentials',
  'apikey',
  'api_key',
  'secret',
  'clientsecret',
  'client_secret',
  'visitortoken',
]);

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEYS.has(key.toLowerCase());
}

function redactValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value)) {
    return '[CIRCULAR]';
  }
  if (depth >= MAX_DEPTH) {
    return Array.isArray(value) ? '[ARRAY]' : '[OBJECT]';
  }

  if (Array.isArray(value)) {
    seen.add(value);
    return value.map((item) => redactValue(item, depth + 1, seen));
  }

  if (value instanceof Date) {
    return value;
  }

  if (value instanceof Error) {
    // Erros NÃO podem passar intactos: bibliotecas HTTP de terceiros (e o
    // padrão `Object.assign(new Error(...), { accessToken, headers, ... })`)
    // costumam anexar propriedades extras a instâncias de Error, e essas
    // propriedades são enumeráveis (diferente de `message`/`stack`, que não
    // são). Preservamos name/message/stack explicitamente (não sobrevivem a
    // uma cópia via Object.entries) e aplicamos a mesma redação recursiva às
    // demais propriedades próprias — do jeito que já é feito para objetos
    // comuns logo abaixo.
    seen.add(value);
    const output: Record<string, unknown> = {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
    for (const [key, entry] of Object.entries(value)) {
      if (key === 'name' || key === 'message' || key === 'stack') {
        continue;
      }
      output[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, depth + 1, seen);
    }
    return output;
  }

  seen.add(value);
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = isSensitiveKey(key) ? REDACTED : redactValue(entry, depth + 1, seen);
  }
  return output;
}

/**
 * Redige recursivamente as chaves sensíveis de `value`. Primitivos e `null`/
 * `undefined` retornam inalterados. Nunca lança (proteção contra ciclos e
 * profundidade excessiva) — usada em caminho de log, nunca deve derrubar a
 * aplicação.
 */
export function redactSensitive<T>(value: T): T {
  return redactValue(value, 0, new WeakSet<object>()) as T;
}
