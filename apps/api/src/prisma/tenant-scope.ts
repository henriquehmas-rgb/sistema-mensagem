import { Prisma } from '@prisma/client';

/**
 * Modelos tenant (possuem coluna org_id obrigatória). CONTRACTS §9:
 * toda query desses modelos recebe `orgId` injetado automaticamente.
 * Fora da lista: Organization (é o próprio tenant), RefreshToken (escopo por user),
 * ConversationTag (m2m puro, escopado via conversation/tag) e WebhookEventLog
 * (orgId opcional; escrito por webhooks via prismaSystem).
 */
export const TENANT_MODELS: ReadonlySet<Prisma.ModelName> = new Set<Prisma.ModelName>([
  'User',
  'Channel',
  'Contact',
  'ContactIdentity',
  'PipelineStage',
  'Conversation',
  'Message',
  'Tag',
  'Automation',
  'AutomationRun',
  'KnowledgeSource',
  'KnowledgeChunk',
  'AuditLog',
]);

export function isTenantModel(model: string): boolean {
  return TENANT_MODELS.has(model as Prisma.ModelName);
}

const WHERE_OPERATIONS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

type QueryArgs = Record<string, unknown> | undefined;

/**
 * Injeta o orgId do tenant nos args de uma operação Prisma.
 * - reads/updates/deletes/aggregations: merge em `where` (sobrescreve orgId explícito
 *   divergente — um tenant nunca alcança dados de outro);
 * - create/createMany: injeta em `data`;
 * - upsert: injeta em `where` e em `create`.
 * Operação desconhecida em modelo tenant → erro (fail closed, sem vazamento silencioso).
 */
export function applyTenantScope(
  operation: string,
  args: QueryArgs,
  orgId: string,
): Record<string, unknown> {
  const scoped: Record<string, unknown> = { ...(args ?? {}) };

  if (operation === 'create') {
    scoped.data = { ...((scoped.data as Record<string, unknown> | undefined) ?? {}), orgId };
    return scoped;
  }

  if (operation === 'createMany' || operation === 'createManyAndReturn') {
    const data = scoped.data;
    scoped.data = Array.isArray(data)
      ? data.map((item: Record<string, unknown>) => ({ ...item, orgId }))
      : { ...((data as Record<string, unknown> | undefined) ?? {}), orgId };
    return scoped;
  }

  if (operation === 'upsert') {
    scoped.where = { ...((scoped.where as Record<string, unknown> | undefined) ?? {}), orgId };
    scoped.create = { ...((scoped.create as Record<string, unknown> | undefined) ?? {}), orgId };
    return scoped;
  }

  if (WHERE_OPERATIONS.has(operation)) {
    scoped.where = { ...((scoped.where as Record<string, unknown> | undefined) ?? {}), orgId };
    return scoped;
  }

  throw new Error(
    `Operação "${operation}" não suportada pelo escopo de tenant. ` +
      'Use prismaSystem explicitamente se esta operação não deve ser escopada.',
  );
}
