import { describe, expect, it } from 'vitest';
import { applyTenantScope, isTenantModel } from './tenant-scope';

const ORG = 'org_seeg';

describe('isTenantModel', () => {
  it('inclui todos os modelos com org_id obrigatório', () => {
    for (const model of [
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
      'MessageTemplate',
    ]) {
      expect(isTenantModel(model), model).toBe(true);
    }
  });

  it('exclui modelos não-tenant', () => {
    for (const model of ['Organization', 'RefreshToken', 'ConversationTag', 'WebhookEventLog']) {
      expect(isTenantModel(model), model).toBe(false);
    }
  });
});

describe('applyTenantScope', () => {
  it('query sem orgId explícito é escopada (findMany sem args)', () => {
    expect(applyTenantScope('findMany', undefined, ORG)).toEqual({
      where: { orgId: ORG },
    });
  });

  it('merge do orgId em where existente sem perder filtros', () => {
    const result = applyTenantScope('findMany', { where: { status: 'OPEN' } }, ORG);
    expect(result).toEqual({ where: { status: 'OPEN', orgId: ORG } });
  });

  it('sobrescreve orgId explícito de outro tenant (anti cross-tenant)', () => {
    const result = applyTenantScope('findMany', { where: { orgId: 'org_intrusa' } }, ORG);
    expect(result).toEqual({ where: { orgId: ORG } });
  });

  it('escopa findUnique/update/delete por where', () => {
    for (const op of ['findUnique', 'findUniqueOrThrow', 'update', 'delete', 'deleteMany']) {
      const result = applyTenantScope(op, { where: { id: 'abc' } }, ORG);
      expect(result.where).toEqual({ id: 'abc', orgId: ORG });
    }
  });

  it('escopa count/aggregate/groupBy mesmo sem where', () => {
    for (const op of ['count', 'aggregate', 'groupBy']) {
      const result = applyTenantScope(op, {}, ORG);
      expect(result.where).toEqual({ orgId: ORG });
    }
  });

  it('injeta orgId em create.data', () => {
    const result = applyTenantScope('create', { data: { name: 'Maria' } }, ORG);
    expect(result.data).toEqual({ name: 'Maria', orgId: ORG });
  });

  it('injeta orgId em cada item de createMany', () => {
    const result = applyTenantScope(
      'createMany',
      { data: [{ name: 'A' }, { name: 'B' }] },
      ORG,
    );
    expect(result.data).toEqual([
      { name: 'A', orgId: ORG },
      { name: 'B', orgId: ORG },
    ]);
  });

  it('injeta orgId em upsert (where + create)', () => {
    const result = applyTenantScope(
      'upsert',
      { where: { id: 'x' }, create: { name: 'N' }, update: { name: 'M' } },
      ORG,
    );
    expect(result.where).toEqual({ id: 'x', orgId: ORG });
    expect(result.create).toEqual({ name: 'N', orgId: ORG });
    expect(result.update).toEqual({ name: 'M' });
  });

  it('não muta os args originais', () => {
    const args = { where: { status: 'OPEN' } };
    applyTenantScope('findMany', args, ORG);
    expect(args).toEqual({ where: { status: 'OPEN' } });
  });

  it('falha fechado em operação desconhecida', () => {
    expect(() => applyTenantScope('queryRawUnsafe', {}, ORG)).toThrow(/não suportada/);
  });
});
