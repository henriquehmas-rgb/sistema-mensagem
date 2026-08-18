import { z } from 'zod';

const HEX_32_BYTES = /^[0-9a-fA-F]{64}$/;

/**
 * Env vars do CONTRACTS §8, validadas com zod.
 * Em produção: variáveis obrigatórias ausentes derrubam o boot com erro claro.
 * Em dev/test: defaults sensatos permitem rodar sem .env.
 */
export function createEnvSchema(nodeEnv: string) {
  const prod = nodeEnv === 'production';
  const required = (devDefault: string) =>
    prod ? z.string().min(1) : z.string().min(1).default(devDefault);

  const encryptionKey = z
    .string()
    .regex(HEX_32_BYTES, 'APP_ENCRYPTION_KEY deve ser 32 bytes em hex (64 chars) — gere com: openssl rand -hex 32');

  return z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),

    DATABASE_URL: required('postgresql://sm:sm@localhost:5432/sm'),
    REDIS_URL: required('redis://localhost:6379'),

    JWT_SECRET: required('dev-jwt-secret-do-not-use-in-prod'),
    JWT_REFRESH_SECRET: required('dev-jwt-refresh-secret-do-not-use-in-prod'),
    APP_ENCRYPTION_KEY: prod
      ? encryptionKey
      : encryptionKey.default('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),

    AI_SERVICE_URL: required('http://localhost:8100'),
    AI_SERVICE_TOKEN: required('dev-ai-service-token'),
    AI_PROVIDER: z.enum(['mock', 'openai', 'anthropic', 'google']).default('mock'),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    GOOGLE_API_KEY: z.string().optional(),

    META_APP_SECRET: required('dev-meta-app-secret'),
    META_VERIFY_TOKEN: required('dev-meta-verify-token'),
    META_GRAPH_VERSION: z.string().min(1).default('v21.0'),

    PUBLIC_URL: required('http://localhost:3000'),
  });
}

export type Env = z.infer<ReturnType<typeof createEnvSchema>>;

export function validateEnv(config: Record<string, unknown>): Env {
  const nodeEnv = typeof config.NODE_ENV === 'string' ? config.NODE_ENV : 'development';
  const result = createEnvSchema(nodeEnv).safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Variáveis de ambiente inválidas ou ausentes:\n${issues}`);
  }
  return result.data;
}
