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
    // Janela curta para reunir mensagens fragmentadas antes de responder.
    // Zero desativa o agrupamento sem exigir alteração de código.
    AI_REPLY_DEBOUNCE_MS: z.coerce.number().int().min(0).max(15_000).default(8_000),
    AI_MONTHLY_ATTENTION_BUDGET_BRL: z.coerce.number().positive().default(2_500),
    OPENAI_API_KEY: z.string().optional(),
    ANTHROPIC_API_KEY: z.string().optional(),
    GOOGLE_API_KEY: z.string().optional(),

    META_APP_SECRET: required('dev-meta-app-secret'),
    META_VERIFY_TOKEN: required('dev-meta-verify-token'),
    META_GRAPH_VERSION: z.string().min(1).default('v21.0'),

    PUBLIC_URL: required('http://localhost:3000'),

    // Lista CSV de hosts IXC autorizados. Evita que uma URL configurável seja
    // usada para alcançar serviços internos (SSRF). Ex.: ixc.seeg.com.br.
    IXC_ALLOWED_HOSTS: z.string().default(''),

    // Olho de Deus: integração estritamente de leitura. HTTP só é aceito por
    // configuração explícita e temporária, para uso atrás de transporte privado.
    // Estas chaves já são usadas pela versão implantada do conector e precisam
    // permanecer no contrato ao publicar alterações independentes do InMap.
    OLHO_DE_DEUS_BASE_URL: z.string().default(''),
    OLHO_DE_DEUS_API_KEY: z.string().optional(),
    OLHO_DE_DEUS_ALLOWED_HOSTS: z.string().default(''),
    OLHO_DE_DEUS_ALLOW_HTTP: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),

    // Libera somente o endpoint nativo de viabilidade técnica do InMap,
    // homologado por CEP/endereço ou coordenadas. A Auto Viabilidade legada
    // de formulário/prospecção permanece fora deste fluxo.
    IXC_INMAP_DIRECT_CHECK_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
    // Mantido apenas para compatibilidade de ambiente. O Omni não apresenta
    // essa URL ao cliente: a confirmação ocorre no próprio WhatsApp.
    IXC_INMAP_AUTO_VIABILITY_PUBLIC_URL: z.string().trim().default(''),

    // Diretório da mídia inbound re-hospedada (CONTRACTS §6) — compose: /data/media.
    MEDIA_DIR: z.string().min(1).default('./storage/media'),

    // Cota diária de uploads outbound por org (CONTRACTS §13) — defesa contra
    // esgotamento de disco do volume media_data (compartilhado entre TODAS as
    // orgs). Sempre com default: não é segredo, não precisa ser obrigatória em produção.
    UPLOAD_DAILY_QUOTA_PER_ORG: z.coerce.number().int().positive().default(300),

    // Observabilidade (CONTRACTS §14). METRICS_TOKEN: obrigatório em
    // produção (sem default — precisa ser gerado); opcional em dev (sem
    // token, GET /api/metrics fica sempre 401 — ver validateEnv abaixo para
    // o warning). SENTRY_DSN: sempre opcional, vazio = Sentry desligado.
    METRICS_TOKEN: prod
      ? z.string().min(1, 'METRICS_TOKEN é obrigatório em produção — gere com: openssl rand -hex 32')
      : z.string().optional(),
    SENTRY_DSN: z.string().optional(),

    // Alertas próprios: a URL é segredo operacional de um Workflow do Teams.
    // A entrega continua desligada até o administrador definir explicitamente
    // as duas variáveis no ambiente seguro do servidor.
    OPERATIONS_TEAMS_WEBHOOK_URL: z.string().url().optional().refine(
      (value) => !value || value.startsWith('https://'),
      'OPERATIONS_TEAMS_WEBHOOK_URL deve usar HTTPS',
    ),
    OPERATIONS_TEAMS_ALERTS_ENABLED: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
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

  if (result.data.OPERATIONS_TEAMS_ALERTS_ENABLED && !result.data.OPERATIONS_TEAMS_WEBHOOK_URL) {
    throw new Error('OPERATIONS_TEAMS_ALERTS_ENABLED exige OPERATIONS_TEAMS_WEBHOOK_URL no ambiente seguro');
  }

  // Fora de produção METRICS_TOKEN é opcional (não derruba o boot), mas sem
  // ela GET /api/metrics fica sempre 401 — avisa em vez de falhar silencioso.
  if (nodeEnv !== 'production' && !result.data.METRICS_TOKEN) {
    // eslint-disable-next-line no-console
    console.warn(
      '[env] METRICS_TOKEN não definido — GET /api/metrics ficará inacessível (401) até você defini-la.',
    );
  }

  return result.data;
}
