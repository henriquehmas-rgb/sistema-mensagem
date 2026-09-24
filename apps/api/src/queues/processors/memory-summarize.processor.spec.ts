import 'reflect-metadata';
import { MessageDirection, MessageType } from '@prisma/client';
import type { Job } from 'bullmq';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemorySummarizeProcessor } from './memory-summarize.processor';
import type { MemorySummarizeJob } from '../queues.constants';

/**
 * MemorySummarizeProcessor (CONTRACTS §15): funde as mensagens da conversa
 * resolvida com o memorySummary atual do contato via serviço de IA, grava
 * memorySummary/memoryUpdatedAt e emite contact:updated. Segue o padrão de
 * mocks hand-rolled do resto do repo (sem TestingModule).
 */

const ORG_ID = 'org_seeg';
const CONTACT_ID = 'contact_1';
const CONVERSATION_ID = 'conv_1';

function contactFixture(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CONTACT_ID,
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
  };
}

function messageFixture(overrides: Partial<Record<string, unknown>>) {
  return {
    id: 'msg',
    orgId: ORG_ID,
    conversationId: CONVERSATION_ID,
    direction: MessageDirection.INBOUND,
    type: MessageType.TEXT,
    content: { text: 'oi' },
    status: 'SENT',
    authorId: null as string | null,
    isAiGenerated: false,
    errorMessage: null,
    createdAt: new Date('2026-01-01T00:01:00.000Z'),
    updatedAt: new Date('2026-01-01T00:01:00.000Z'),
    ...overrides,
  };
}

function createHarness() {
  const contact = contactFixture();
  // SYSTEM já excluída pelo próprio filtro da query (type: { not: SYSTEM }) —
  // não entra na fixture retornada pelo findMany mockado.
  const messages = [
    messageFixture({
      id: 'm1',
      direction: MessageDirection.INBOUND,
      type: MessageType.TEXT,
      content: { text: 'Meu nome é Ana' },
    }),
    messageFixture({
      id: 'm2',
      direction: MessageDirection.OUTBOUND,
      type: MessageType.TEXT,
      content: { text: 'Olá Ana, como posso ajudar?' },
    }),
    messageFixture({
      id: 'm3',
      direction: MessageDirection.INBOUND,
      type: MessageType.IMAGE,
      content: { mediaUrl: 'https://x/img.png', mimeType: 'image/png' },
    }),
  ];

  const prismaSystem = {
    contact: {
      findFirst: vi.fn().mockImplementation(() => Promise.resolve(contact)),
      update: vi.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...contact, ...data }),
      ),
    },
    message: {
      findMany: vi.fn().mockImplementation(() => Promise.resolve(messages)),
    },
    conversation: {
      findFirst: vi.fn().mockResolvedValue({ lastIntent: 'technical_support', department: { routingKey: 'technical_support' } }),
    },
    learningCandidate: { upsert: vi.fn().mockResolvedValue({ id: 'candidate_1', publishedSourceId: null }), update: vi.fn() },
    knowledgeSource: { create: vi.fn().mockResolvedValue({ id: 'source_1' }) },
  };
  const prisma = { prismaSystem };
  const realtime = { emitContactUpdated: vi.fn() };
  const aiClient = {
    summarizeMemory: vi
      .fn()
      .mockResolvedValue({ summary: 'Ana prefere atendimento por WhatsApp.' }),
    prepareLearningCandidate: vi.fn().mockResolvedValue({ eligible: false }),
  };
  const knowledgeIngestQueue = { add: vi.fn() };
  const processor = new MemorySummarizeProcessor(
    prisma as never,
    realtime as never,
    aiClient as never,
    knowledgeIngestQueue as never,
  );

  return { processor, prismaSystem, realtime, aiClient, knowledgeIngestQueue, contact, messages };
}

function jobFor(overrides: Partial<MemorySummarizeJob> = {}): Job<MemorySummarizeJob> {
  return {
    data: {
      orgId: ORG_ID,
      contactId: CONTACT_ID,
      conversationId: CONVERSATION_ID,
      ...overrides,
    },
  } as unknown as Job<MemorySummarizeJob>;
}

describe('MemorySummarizeProcessor', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('funde o resumo existente com as mensagens da conversa, grava e emite contact:updated', async () => {
    await harness.processor.process(jobFor());

    expect(harness.prismaSystem.message.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { conversationId: CONVERSATION_ID, orgId: ORG_ID, type: { not: MessageType.SYSTEM } },
      orderBy: { createdAt: 'asc' },
    });
    expect(harness.aiClient.summarizeMemory).toHaveBeenCalledExactlyOnceWith({
      org_id: ORG_ID,
      existing_summary: null,
      messages: [
        { role: 'user', content: 'Meu nome é Ana' },
        { role: 'assistant', content: 'Olá Ana, como posso ajudar?' },
        { role: 'user', content: '[enviou uma imagem]' },
      ],
    });
    expect(harness.prismaSystem.contact.update).toHaveBeenCalledExactlyOnceWith({
      where: { id: CONTACT_ID },
      data: {
        memorySummary: 'Ana prefere atendimento por WhatsApp.',
        memoryUpdatedAt: expect.any(Date),
      },
    });
    expect(harness.realtime.emitContactUpdated).toHaveBeenCalledExactlyOnceWith(ORG_ID, {
      contact: expect.objectContaining({
        id: CONTACT_ID,
        memorySummary: 'Ana prefere atendimento por WhatsApp.',
      }),
    });
  });

  it('envia o memorySummary atual do contato como existing_summary', async () => {
    harness.prismaSystem.contact.findFirst.mockResolvedValue(
      contactFixture({ memorySummary: 'Já é cliente há 2 anos.' }),
    );

    await harness.processor.process(jobFor());

    expect(harness.aiClient.summarizeMemory).toHaveBeenCalledWith(
      expect.objectContaining({ existing_summary: 'Já é cliente há 2 anos.' }),
    );
  });

  it('contato inexistente na org → descarta sem chamar a IA nem gravar', async () => {
    harness.prismaSystem.contact.findFirst.mockResolvedValue(null);

    await harness.processor.process(jobFor());

    expect(harness.aiClient.summarizeMemory).not.toHaveBeenCalled();
    expect(harness.prismaSystem.contact.update).not.toHaveBeenCalled();
    expect(harness.realtime.emitContactUpdated).not.toHaveBeenCalled();
  });

  it('conversa sem mensagens → não chama a IA nem grava', async () => {
    harness.prismaSystem.message.findMany.mockResolvedValue([]);

    await harness.processor.process(jobFor());

    expect(harness.aiClient.summarizeMemory).not.toHaveBeenCalled();
    expect(harness.prismaSystem.contact.update).not.toHaveBeenCalled();
  });

  it('falha na chamada de IA propaga o erro (retry do BullMQ) e NÃO apaga a memória existente', async () => {
    harness.aiClient.summarizeMemory.mockRejectedValue(new Error('timeout'));

    await expect(harness.processor.process(jobFor())).rejects.toThrow('timeout');

    expect(harness.prismaSystem.contact.update).not.toHaveBeenCalled();
    expect(harness.realtime.emitContactUpdated).not.toHaveBeenCalled();
  });

  it('resumo devolvido idêntico ao atual (fail-safe/sem fatos novos) → não grava nem emite', async () => {
    const existing = 'Já é cliente há 2 anos.';
    harness.prismaSystem.contact.findFirst.mockResolvedValue(
      contactFixture({ memorySummary: existing }),
    );
    harness.aiClient.summarizeMemory.mockResolvedValue({ summary: existing });

    await harness.processor.process(jobFor());

    expect(harness.prismaSystem.contact.update).not.toHaveBeenCalled();
    expect(harness.realtime.emitContactUpdated).not.toHaveBeenCalled();
  });

  it('captura a última solução humana sanitizada como candidata pendente', async () => {
    harness.messages[1]!.authorId = 'user_1';
    harness.aiClient.prepareLearningCandidate.mockResolvedValue({
      eligible: true,
      content: 'Pergunta recorrente: Meu nome é Ana\nResposta validada por atendente: Olá Ana, como posso ajudar?',
      quality_score: 0.8,
      fingerprint: 'fingerprint_1',
      auto_publish_eligible: false,
    });

    await harness.processor.process(jobFor());

    expect(harness.aiClient.prepareLearningCandidate).toHaveBeenCalledExactlyOnceWith({
      question: 'Meu nome é Ana',
      answer: 'Olá Ana, como posso ajudar?',
      department_key: 'technical_support',
    });
    expect(harness.prismaSystem.learningCandidate.upsert).toHaveBeenCalledWith({
      where: { orgId_conversationId: { orgId: ORG_ID, conversationId: CONVERSATION_ID } },
      create: {
        orgId: ORG_ID,
        conversationId: CONVERSATION_ID,
        intent: 'technical_support',
        content: expect.stringContaining('Resposta validada por atendente'),
        fingerprint: 'fingerprint_1',
        qualityScore: 0.8,
        autoPublishEligible: false,
      },
      update: {
        intent: 'technical_support',
        content: expect.stringContaining('Resposta validada por atendente'),
        fingerprint: 'fingerprint_1',
        qualityScore: 0.8,
        autoPublishEligible: false,
      },
    });
  });

  it('publica provisoriamente uma solução técnica elegível para revisão semanal', async () => {
    harness.messages[1]!.authorId = 'user_1';
    harness.aiClient.prepareLearningCandidate.mockResolvedValue({
      eligible: true,
      content: 'Pergunta recorrente: Internet sem conexão\nResposta registrada por atendente: Reinicie o roteador por trinta segundos.',
      quality_score: 0.95,
      fingerprint: 'a'.repeat(64),
      auto_publish_eligible: true,
    });
    await harness.processor.process(jobFor());

    expect(harness.prismaSystem.learningCandidate.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ autoPublishEligible: true, qualityScore: 0.95 }),
        update: expect.objectContaining({ autoPublishEligible: true, qualityScore: 0.95 }),
      }),
    );
    expect(harness.prismaSystem.knowledgeSource.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ type: 'TEXT', meta: expect.objectContaining({ governance: 'AUTO_REVIEW_REQUIRED', weeklyReviewRequired: true }) }),
    }));
  });
});
