import 'reflect-metadata';
import type { Contact } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { toContactDto } from './serializers';

const ORG_ID = 'org_seeg';

function contactFixture(overrides: Partial<Contact> = {}): Contact {
  return {
    id: 'contact_1',
    orgId: ORG_ID,
    name: 'Ana',
    phone: '5511999999999',
    email: null,
    avatarUrl: null,
    notes: null,
    customFields: {},
    memorySummary: null,
    memoryUpdatedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  } as Contact;
}

/**
 * toContactDto — memória de longo prazo por contato (CONTRACTS §15): os dois
 * campos novos precisam sobreviver à serialização com o mesmo tratamento de
 * datas ISO usado no resto do serializer (isoOrNull).
 */
describe('toContactDto — memória de longo prazo (CONTRACTS §15)', () => {
  it('contato sem memória ainda: memorySummary e memoryUpdatedAt null', () => {
    const dto = toContactDto(contactFixture());

    expect(dto.memorySummary).toBeNull();
    expect(dto.memoryUpdatedAt).toBeNull();
  });

  it('contato com memória: memorySummary passa direto e memoryUpdatedAt vira ISO string', () => {
    const updatedAt = new Date('2026-02-10T12:30:00.000Z');
    const dto = toContactDto(
      contactFixture({
        memorySummary: 'Prefere contato por telefone. Já comprou o plano Pro em 2025.',
        memoryUpdatedAt: updatedAt,
      }),
    );

    expect(dto.memorySummary).toBe('Prefere contato por telefone. Já comprou o plano Pro em 2025.');
    expect(dto.memoryUpdatedAt).toBe('2026-02-10T12:30:00.000Z');
  });
});
