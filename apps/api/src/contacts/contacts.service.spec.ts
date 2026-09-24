import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContactsService } from './contacts.service';

const ORG_ID = 'org_seeg';
const now = new Date('2026-09-15T00:00:00.000Z');

function contact(id: string, memorySummary: string | null = null) {
  return {
    id,
    orgId: ORG_ID,
    name: id,
    phone: null,
    email: null,
    avatarUrl: null,
    notes: null,
    customFields: {},
    memorySummary,
    memoryUpdatedAt: memorySummary ? now : null,
    createdAt: now,
    updatedAt: now,
  };
}

function createHarness(target = contact('target'), source = contact('source')) {
  const tx = {
    contactIdentity: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
    conversation: { updateMany: vi.fn().mockResolvedValue({ count: 3 }) },
    contact: {
      update: vi.fn(({ data }: { data: { memorySummary?: string } }) => Promise.resolve({
        ...target,
        memorySummary: data.memorySummary ?? target.memorySummary,
        memoryUpdatedAt: data.memorySummary ? now : target.memoryUpdatedAt,
      })),
      delete: vi.fn().mockResolvedValue(source),
    },
  };
  const prisma = {
    tenant: {
      contact: {
        findUnique: vi.fn(({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === target.id ? target : where.id === source.id ? source : null)),
      },
    },
    prismaSystem: {
      $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    },
  };
  const realtime = { emitContactUpdated: vi.fn() };
  const tenancy = { getOrgIdOrThrow: vi.fn().mockReturnValue(ORG_ID) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  return {
    tx,
    realtime,
    audit,
    service: new ContactsService(prisma as never, realtime as never, tenancy as never, audit as never),
  };
}

describe('ContactsService — mesclagem manual de identidades', () => {
  it('move identidades e conversas apenas após confirmação explícita', async () => {
    const h = createHarness(contact('target'), contact('source', 'Resumo preservado'));

    await expect(
      h.service.mergeInto('target', { sourceContactId: 'source', confirm: true, reason: 'Vínculo confirmado' }),
    ).resolves.toMatchObject({ id: 'target', memorySummary: 'Resumo preservado' });

    expect(h.tx.contactIdentity.updateMany).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, contactId: 'source' },
      data: { contactId: 'target' },
    });
    expect(h.tx.conversation.updateMany).toHaveBeenCalledWith({
      where: { orgId: ORG_ID, contactId: 'source' },
      data: { contactId: 'target' },
    });
    expect(h.tx.contact.delete).toHaveBeenCalledWith({ where: { id: 'source' } });
    expect(h.audit.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'contact.merge',
      meta: expect.objectContaining({ identitiesTransferred: 2, conversationsTransferred: 3 }),
    }));
  });

  it('bloqueia mesclagem quando as duas memórias exigem revisão humana', async () => {
    const h = createHarness(contact('target', 'Resumo A'), contact('source', 'Resumo B'));

    await expect(
      h.service.mergeInto('target', { sourceContactId: 'source', confirm: true }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(h.tx.contactIdentity.updateMany).not.toHaveBeenCalled();
  });

  it('não aceita mesclar um contato em si mesmo', async () => {
    const h = createHarness();

    await expect(
      h.service.mergeInto('target', { sourceContactId: 'target', confirm: true }),
    ).rejects.toThrow('origem deve ser diferente');
  });
});
