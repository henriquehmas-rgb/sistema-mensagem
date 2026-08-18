import 'reflect-metadata';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ChannelType, TemplateStatus } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { countBodyParams, TemplatesService } from './templates.service';

/**
 * TemplatesService (CONTRACTS §12): sync (upsert por channelId+name+language,
 * cálculo de bodyParamsCount, marcação DISABLED de templates que sumiram da
 * resposta da Meta) e listagem tenant-scoped. Segue o padrão de mocks
 * hand-rolled dos demais specs do repo (sem TestingModule).
 */

const CHANNEL_ID = 'ch_wa1';
const ORG_ID = 'org_seeg';

const whatsappChannel = {
  id: CHANNEL_ID,
  orgId: ORG_ID,
  type: ChannelType.WHATSAPP,
  encryptedCredentials: 'enc',
};

interface FixtureRow {
  id: string;
  orgId: string;
  channelId: string;
  name: string;
  language: string;
  category: string;
  status: TemplateStatus;
  components: unknown[];
  bodyParamsCount: number;
  metaTemplateId: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Linha completa o bastante para `toDto` — testes de disappeared só variam id/name/language/status. */
function fixtureRow(overrides: Partial<FixtureRow> & Pick<FixtureRow, 'id' | 'name' | 'status'>): FixtureRow {
  return {
    orgId: ORG_ID,
    channelId: CHANNEL_ID,
    language: 'pt_BR',
    category: 'MARKETING',
    components: [],
    bodyParamsCount: 0,
    metaTemplateId: null,
    lastSyncedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function createHarness() {
  const messageTemplateRows: FixtureRow[] = [];

  const tenant = {
    channel: { findUnique: vi.fn().mockResolvedValue(whatsappChannel) },
    messageTemplate: {
      upsert: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockImplementation(() => Promise.resolve(messageTemplateRows)),
      updateMany: vi.fn().mockImplementation(({ where, data }) => {
        for (const row of messageTemplateRows) {
          if (where.id.in.includes(row.id)) row.status = data.status;
        }
        return Promise.resolve({ count: where.id.in.length });
      }),
    },
  };
  const prisma = { tenant };
  const tenancy = { getOrgIdOrThrow: vi.fn().mockReturnValue(ORG_ID) };
  const audit = { log: vi.fn().mockResolvedValue(undefined) };
  const metaGraph = {
    decryptCredentials: vi.fn().mockReturnValue({ accessToken: 'tok', wabaId: 'waba123' }),
    syncTemplates: vi.fn(),
  };

  const service = new TemplatesService(
    prisma as never,
    tenancy as never,
    audit as never,
    metaGraph as never,
  );

  return { service, prisma, tenancy, audit, metaGraph, messageTemplateRows };
}

describe('countBodyParams', () => {
  it('conta placeholders {{n}} únicos no componente BODY', () => {
    const components = [
      { type: 'HEADER', text: 'Olá {{1}}' },
      { type: 'BODY', text: 'Seu pedido {{1}} chega em {{2}} dias. Obrigado {{1}}!' },
      { type: 'FOOTER', text: 'Equipe SEEG' },
    ];
    expect(countBodyParams(components)).toBe(2);
  });

  it('sem componente BODY → 0', () => {
    expect(countBodyParams([{ type: 'HEADER', text: 'Oi {{1}}' }])).toBe(0);
  });

  it('BODY sem placeholders → 0', () => {
    expect(countBodyParams([{ type: 'BODY', text: 'Mensagem fixa sem parâmetros.' }])).toBe(0);
  });

  it('components não é array → 0', () => {
    expect(countBodyParams(null)).toBe(0);
    expect(countBodyParams(undefined)).toBe(0);
  });
});

describe('TemplatesService.sync', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('faz upsert por (channelId, name, language) com bodyParamsCount calculado', async () => {
    harness.metaGraph.syncTemplates.mockResolvedValue([
      {
        name: 'hello_world',
        language: 'pt_BR',
        status: 'APPROVED',
        category: 'MARKETING',
        components: [{ type: 'BODY', text: 'Olá {{1}}, seu código é {{2}}.' }],
        id: 'meta_tpl_1',
      },
    ]);

    await harness.service.sync(CHANNEL_ID);

    expect(harness.metaGraph.syncTemplates).toHaveBeenCalledWith(
      { accessToken: 'tok', wabaId: 'waba123' },
      'waba123',
    );
    expect(harness.prisma.tenant.messageTemplate.upsert).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        where: {
          channelId_name_language: { channelId: CHANNEL_ID, name: 'hello_world', language: 'pt_BR' },
        },
        create: expect.objectContaining({
          orgId: ORG_ID,
          channelId: CHANNEL_ID,
          name: 'hello_world',
          language: 'pt_BR',
          category: 'MARKETING',
          status: 'APPROVED',
          bodyParamsCount: 2,
          metaTemplateId: 'meta_tpl_1',
        }),
        update: expect.objectContaining({ bodyParamsCount: 2, status: 'APPROVED' }),
      }),
    );
  });

  it('templates que sumiram da resposta viram DISABLED (não deletados)', async () => {
    harness.messageTemplateRows.push(
      fixtureRow({ id: 't1', name: 'still_here', status: TemplateStatus.APPROVED }),
      fixtureRow({ id: 't2', name: 'vanished', status: TemplateStatus.APPROVED }),
      fixtureRow({ id: 't3', name: 'already_disabled', status: TemplateStatus.DISABLED }),
    );
    harness.metaGraph.syncTemplates.mockResolvedValue([
      {
        name: 'still_here',
        language: 'pt_BR',
        status: 'APPROVED',
        category: 'UTILITY',
        components: [],
      },
    ]);

    await harness.service.sync(CHANNEL_ID);

    expect(harness.prisma.tenant.messageTemplate.updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ['t2'] } },
      data: { status: TemplateStatus.DISABLED },
    });
    // 'already_disabled' (t3) já estava DISABLED — não entra no updateMany de novo.
    expect(harness.messageTemplateRows.find((row) => row.id === 't3')?.status).toBe(
      TemplateStatus.DISABLED,
    );
  });

  it('categoria/status desconhecidos da Meta caem em fallback seguro', async () => {
    harness.metaGraph.syncTemplates.mockResolvedValue([
      {
        name: 'weird',
        language: 'pt_BR',
        status: 'SOME_NEW_STATUS',
        category: 'SOME_NEW_CATEGORY',
        components: [],
      },
    ]);

    await harness.service.sync(CHANNEL_ID);

    expect(harness.prisma.tenant.messageTemplate.upsert).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        create: expect.objectContaining({ category: 'UTILITY', status: 'PENDING' }),
      }),
    );
  });

  it('canal não-WhatsApp → BadRequestException, sem chamar a Meta', async () => {
    harness.prisma.tenant.channel.findUnique.mockResolvedValue({
      ...whatsappChannel,
      type: ChannelType.INSTAGRAM,
    });
    await expect(harness.service.sync(CHANNEL_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.metaGraph.syncTemplates).not.toHaveBeenCalled();
  });

  it('canal sem wabaId nas credenciais → BadRequestException', async () => {
    harness.metaGraph.decryptCredentials.mockReturnValue({ accessToken: 'tok' });
    await expect(harness.service.sync(CHANNEL_ID)).rejects.toBeInstanceOf(BadRequestException);
    expect(harness.metaGraph.syncTemplates).not.toHaveBeenCalled();
  });

  it('canal inexistente na org → NotFoundException', async () => {
    harness.prisma.tenant.channel.findUnique.mockResolvedValue(null);
    await expect(harness.service.sync(CHANNEL_ID)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('falha da Graph API → ServiceUnavailableException (não propaga o erro cru)', async () => {
    harness.metaGraph.syncTemplates.mockRejectedValue(new Error('Graph API 500: timeout'));
    await expect(harness.service.sync(CHANNEL_ID)).rejects.toThrow(
      /Falha ao sincronizar templates/,
    );
  });

  it('sync concorrente para o mesmo canal → ConflictException (lock em memória)', async () => {
    let resolveSync: (value: unknown[]) => void = () => {};
    harness.metaGraph.syncTemplates.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );

    const first = harness.service.sync(CHANNEL_ID);
    await Promise.resolve(); // deixa o primeiro sync registrar o lock antes do segundo
    await expect(harness.service.sync(CHANNEL_ID)).rejects.toBeInstanceOf(ConflictException);

    resolveSync([]);
    await expect(first).resolves.toBeDefined();
  });

  it('libera o lock ao terminar (sucesso ou falha) — sync subsequente funciona', async () => {
    harness.metaGraph.syncTemplates.mockResolvedValueOnce([]);
    await harness.service.sync(CHANNEL_ID);

    harness.metaGraph.syncTemplates.mockResolvedValueOnce([]);
    await expect(harness.service.sync(CHANNEL_ID)).resolves.toBeDefined();

    harness.metaGraph.syncTemplates.mockRejectedValueOnce(new Error('boom'));
    await expect(harness.service.sync(CHANNEL_ID)).rejects.toThrow();

    harness.metaGraph.syncTemplates.mockResolvedValueOnce([]);
    await expect(harness.service.sync(CHANNEL_ID)).resolves.toBeDefined();
  });
});

describe('TemplatesService.list', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('filtra por status quando informado', async () => {
    await harness.service.list(CHANNEL_ID, TemplateStatus.APPROVED);
    expect(harness.prisma.tenant.messageTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channelId: CHANNEL_ID, status: TemplateStatus.APPROVED } }),
    );
  });

  it('sem status → lista todos os templates do canal', async () => {
    await harness.service.list(CHANNEL_ID);
    expect(harness.prisma.tenant.messageTemplate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { channelId: CHANNEL_ID } }),
    );
  });

  it('canal inexistente na org → NotFoundException', async () => {
    harness.prisma.tenant.channel.findUnique.mockResolvedValue(null);
    await expect(harness.service.list(CHANNEL_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});
