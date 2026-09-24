import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConversationStatus,
  MessageType,
  MessageDirection,
  MessageStatus,
  Prisma,
  type ChannelType,
  type Contact,
} from '@prisma/client';
import { Queue } from 'bullmq';
import {
  conversationInclude,
  messageInclude,
  messagePreview,
  toConversationDto,
  toMessageDto,
  type ConversationWithRelations,
  type MessageWithAuthor,
} from '../common/serializers';
import { createConversationProtocol } from '../common/protocol';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUES, type AiReplyJob, type AutomationRunJob, type WhatsappPresenceJob } from '../queues/queues.constants';
import { RealtimeService } from '../realtime/realtime.service';
import { IxcService, type IdentityChallengeResult } from '../integrations/ixc/ixc.service';
import { FollowUpService } from '../follow-up/follow-up.service';
import type { Env } from '../config/env.validation';

const STAGE_POSITION_GAP = 1_024;
const DEFAULT_CONTACT_NAME = 'Visitante';

/**
 * WebChat pode exigir que uma divergência de cadastros seja resolvida antes
 * de criar uma nova identidade. Assim, um telefone legado duplicado não gera
 * um terceiro contato nem mistura dois históricos por tentativa e erro.
 */
export class AmbiguousContactPhoneError extends Error {
  constructor() {
    super('Mais de um contato encontrado para o telefone informado');
    this.name = 'AmbiguousContactPhoneError';
  }
}

/**
 * O WhatsApp chega em E.164 (ex.: +5565...), enquanto alguém no WebChat pode
 * informar o número local. Comparamos formatos equivalentes para centralizar
 * o histórico no mesmo contato sem regravar ou expor o número recebido.
 */
function phoneLookupCandidates(value: string): string[] {
  const original = value.trim();
  const digits = original.replace(/\D/g, '');
  if (!digits) return [];
  const international = digits.startsWith('55')
    ? digits
    : digits.length === 10 || digits.length === 11
      ? `55${digits}`
      : digits;
  const local = international.startsWith('55') && (international.length === 12 || international.length === 13)
    ? international.slice(2)
    : '';
  return [...new Set([original, digits, `+${digits}`, international, `+${international}`, local, local ? `+${local}` : ''])]
    .filter(Boolean);
}

/** Armazenamento canônico para novos contatos; leitura continua aceitando a base legada. */
function canonicalPhone(value: string): string | null {
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  const international = digits.startsWith('55')
    ? digits
    : digits.length === 10 || digits.length === 11
      ? `55${digits}`
      : digits;
  return `+${international}`;
}

export interface InboundIngestInput {
  orgId: string;
  channelId: string;
  channelType: ChannelType;
  /** wa_id / ig user id / webchat visitor id (ContactIdentity.externalId). */
  externalContactId: string;
  contactName?: string;
  contactPhone?: string;
  /** WebChat não cria outro contato quando a base legada já é ambígua. */
  rejectAmbiguousPhoneMatch?: boolean;
  /** Avatar do perfil no canal (ex.: profile_pic do IG) — só usado ao criar o contato. */
  contactAvatarUrl?: string;
  /** wamid — dedupe via unique(orgId, externalId) de Message. */
  externalMessageId?: string;
  type: MessageType;
  content: Record<string, unknown>;
}

export interface InboundIngestResult {
  duplicate: boolean;
  messageId: string | null;
  conversationId: string | null;
}

/**
 * Fluxo INBOUND (ARCHITECTURE + CONTRACTS §4/§5): resolve Channel→Contact→Conversation
 * (criando o que faltar), grava a Message INBOUND com dedupe por wamid,
 * incrementa unreadCount, emite conversation:new/message:new e enfileira
 * ai-reply + automation-run.
 * Roda FORA de contexto de request (processors/rotas públicas) → prismaSystem
 * SEMPRE com orgId explícito em todos os filtros.
 */
@Injectable()
export class InboundMessageService {
  private readonly logger = new Logger(InboundMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
    @InjectQueue(QUEUES.AI_REPLY)
    private readonly aiReplyQueue: Queue<AiReplyJob>,
    @InjectQueue(QUEUES.WHATSAPP_PRESENCE)
    private readonly whatsappPresenceQueue: Queue<WhatsappPresenceJob>,
    @InjectQueue(QUEUES.AUTOMATION_RUN)
    private readonly automationRunQueue: Queue<AutomationRunJob>,
    private readonly ixc: IxcService,
    private readonly followUp: FollowUpService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** Pipeline completo de uma mensagem entrante. */
  async ingest(input: InboundIngestInput): Promise<InboundIngestResult> {
    // Dedupe por wamid ANTES de qualquer efeito colateral (CONTRACTS §4).
    if (input.externalMessageId) {
      const existing = await this.prisma.prismaSystem.message.findFirst({
        where: { orgId: input.orgId, externalId: input.externalMessageId },
        select: { id: true, conversationId: true },
      });
      if (existing) {
        return { duplicate: true, messageId: existing.id, conversationId: existing.conversationId };
      }
    }

    const contact = await this.ensureContact(input);
    const { conversation, created } = await this.ensureConversation(
      input.orgId,
      input.channelId,
      contact.id,
    );

    const safeInput = await this.protectIdentityResponse(
      input,
      conversation.id,
      contact.id,
      this.isAccountIdentityRoute(conversation.lastIntent, conversation.department?.routingKey),
    );
    const message = await this.persistMessage(safeInput, conversation.id);
    if (!message) {
      // corrida no unique(orgId, externalId): outro worker processou o mesmo wamid
      return { duplicate: true, messageId: null, conversationId: conversation.id };
    }

    await this.observeFollowUp(
      input.orgId,
      conversation.id,
      contact.id,
      message.content as Record<string, unknown>,
    );

    if (created) {
      this.realtime.emitConversationNew(input.orgId, {
        conversation: toConversationDto(conversation),
      });
      await this.automationRunQueue.add('conversation.created', {
        orgId: input.orgId,
        event: 'conversation.created',
        context: {
          conversationId: conversation.id,
          contactId: contact.id,
          channelId: input.channelId,
          channelType: input.channelType,
        },
      });
    }

    await this.emitMessageNew(input.orgId, conversation.id, message);

    // IA responde apenas conversas com aiEnabled e SEM agente atribuído (ARCHITECTURE §3).
    if (conversation.aiEnabled && !conversation.assigneeId) {
      if (input.channelType === 'WHATSAPP' && input.externalMessageId?.startsWith('wamid.')) {
        // O recibo roda independentemente da IA; falha de fila nao perde o inbound.
        try {
          await this.whatsappPresenceQueue.add('read-receipt', {
            orgId: input.orgId, messageId: message.id,
          }, { delay: 2_000 });
        } catch {
          this.logger.warn('Nao foi possivel agendar recibo de leitura do WhatsApp');
        }
      }
      await this.enqueueCoalescedReply(input.orgId, conversation.id, message.id);
    }

    await this.automationRunQueue.add('message.inbound', {
      orgId: input.orgId,
      event: 'message.inbound',
      context: {
        conversationId: conversation.id,
        contactId: contact.id,
        channelId: input.channelId,
        channelType: input.channelType,
        messageId: message.id,
        messageType: input.type,
      },
    });

    return { duplicate: false, messageId: message.id, conversationId: conversation.id };
  }

  /**
   * Ingestão em conversa CONHECIDA (webchat: o visitorToken fixa a conversa).
   * Mesmo pipeline de persistência/eventos/filas do ingest(), sem resolução de
   * contato/conversa. Conversa RESOLVED reabre como OPEN ao receber mensagem.
   */
  async ingestIntoConversation(
    input: Pick<
      InboundIngestInput,
      'orgId' | 'channelId' | 'channelType' | 'type' | 'content' | 'externalMessageId'
    > & { conversationId: string; contactId: string },
  ): Promise<InboundIngestResult> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: input.conversationId, orgId: input.orgId },
      select: { id: true, aiEnabled: true, assigneeId: true, lastIntent: true, department: { select: { routingKey: true } } },
    });
    if (!conversation) {
      return { duplicate: false, messageId: null, conversationId: null };
    }

    const safeInput = await this.protectIdentityResponse(
      {
        orgId: input.orgId,
        channelId: input.channelId,
        channelType: input.channelType,
        externalContactId: '',
        externalMessageId: input.externalMessageId,
        type: input.type,
        content: input.content,
      },
      conversation.id,
      input.contactId,
      this.isAccountIdentityRoute(conversation.lastIntent, conversation.department?.routingKey),
    );
    const message = await this.persistMessage(safeInput, conversation.id);
    if (!message) {
      return { duplicate: true, messageId: null, conversationId: conversation.id };
    }

    await this.observeFollowUp(
      input.orgId,
      conversation.id,
      input.contactId,
      message.content as Record<string, unknown>,
    );

    await this.emitMessageNew(input.orgId, conversation.id, message);

    if (conversation.aiEnabled && !conversation.assigneeId) {
      await this.enqueueCoalescedReply(input.orgId, conversation.id, message.id);
    }
    await this.automationRunQueue.add('message.inbound', {
      orgId: input.orgId,
      event: 'message.inbound',
      context: {
        conversationId: conversation.id,
        contactId: input.contactId,
        channelId: input.channelId,
        channelType: input.channelType,
        messageId: message.id,
        messageType: input.type,
      },
    });

    return { duplicate: false, messageId: message.id, conversationId: conversation.id };
  }

  /** Resolve Contact via ContactIdentity, criando contato+identidade se preciso. */
  async ensureContact(
    input: Pick<
      InboundIngestInput,
      | 'orgId'
      | 'channelType'
      | 'externalContactId'
      | 'contactName'
      | 'contactPhone'
      | 'contactAvatarUrl'
      | 'rejectAmbiguousPhoneMatch'
    >,
  ): Promise<Contact> {
    const identity = await this.prisma.prismaSystem.contactIdentity.findUnique({
      where: {
        orgId_channelType_externalId: {
          orgId: input.orgId,
          channelType: input.channelType,
          externalId: input.externalContactId,
        },
      },
      include: { contact: true },
    });
    if (identity) {
      return identity.contact;
    }

    const contact = await this.findOrCreateContact(input);

    try {
      await this.prisma.prismaSystem.contactIdentity.create({
        data: {
          orgId: input.orgId,
          contactId: contact.id,
          channelType: input.channelType,
          externalId: input.externalContactId,
        },
      });
    } catch (error) {
      // corrida: outro worker criou a mesma identidade — segue com o contato dela
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
    }
    return contact;
  }

  private async protectIdentityResponse(
    input: InboundIngestInput,
    conversationId: string,
    contactId: string,
    accountIdentityRoute: boolean,
  ): Promise<InboundIngestInput> {
    // Localização como identificador só existe em Suporte e Financeiro. Em
    // Vendas, a coordenada é processada pelo fluxo próprio de viabilidade;
    // nunca abrimos desafio de identidade nem consultamos cliente a partir dela.
    if (accountIdentityRoute && input.type === MessageType.LOCATION) {
      const latitude = input.content.latitude;
      const longitude = input.content.longitude;
      if (typeof latitude !== 'number' || typeof longitude !== 'number') return input;
      const lookup = await this.ixc.prepareLocationIdentityFallback(
        input.orgId, conversationId, contactId, latitude, longitude,
      );
      if (lookup.status === 'not_requested') return input;
      return {
        ...input,
        content: {
          // A consulta usa o ponto original em memória. No histórico, o ponto
          // fica aproximado e nenhuma coordenada é enviada à IA ou à auditoria.
          latitude: Math.round(latitude * 1_000) / 1_000,
          longitude: Math.round(longitude * 1_000) / 1_000,
          identityLocationStatus: lookup.status,
        },
      };
    }
    const text = input.type === 'TEXT' && typeof input.content.text === 'string'
      ? input.content.text
      : null;
    if (text === null) return input;
    const address = accountIdentityRoute ? this.postalAddressFrom(text) : null;
    if (address) {
      const lookup = await this.ixc.prepareAddressIdentityFallback(
        input.orgId, conversationId, contactId, address.postalCode, address.number,
      );
      if (lookup.status !== 'not_requested') {
        return {
          ...input,
          // CEP e número só existem no processamento transitório da busca.
          content: { text: this.locationIdentityMarker(lookup.status) },
        };
      }
    }
    let result: IdentityChallengeResult | null;
    try {
      result = await this.ixc.consumeIdentityChallenge(input.orgId, conversationId, contactId, text);
    } catch {
      // O desafio estava ativo, mas a fonte não respondeu. Não persistimos a
      // entrada potencialmente sensível; o fluxo poderá pedir uma nova tentativa.
      result = { status: 'unavailable' };
    }
    if (!result) return input;
    // Texto comum após o pedido não é uma tentativa de identidade. Números
    // com três ou mais dígitos continuam mascarados para não persistir CPF.
    if (result.status === 'format_invalid' && text.replace(/\D/g, '').length < 11) return input;
    return {
      ...input,
      content: { text: this.identityMarker(result.status) },
    };
  }

  private identityMarker(status: IdentityChallengeResult['status']): string {
    if (status === 'verified') return '[Identidade validada com segurança]';
    if (status === 'locked') return '[Validação temporariamente bloqueada]';
    if (status === 'unavailable') return '[Validação temporariamente indisponível]';
    if (status === 'format_invalid') return '[Resposta de validação em formato inválido]';
    return '[Identidade não confirmada]';
  }

  /**
   * Resolve a conversa ativa (não RESOLVED) do contato no canal, criando uma nova
   * na stage default quando não houver. Conversa SNOOZED/PENDING reabre como OPEN
   * ao receber mensagem nova (feito em persistMessage).
   */
  private locationIdentityMarker(status: 'candidate_ready' | 'no_candidate' | 'unavailable'): string {
    if (status === 'candidate_ready') return '[Localização recebida para confirmar o cadastro]';
    if (status === 'no_candidate') return '[Localização recebida sem cadastro correspondente]';
    return '[Localização recebida; consulta de cadastro indisponível]';
  }

  private postalAddressFrom(text: string): { postalCode: string; number: string } | null {
    const postal = /\b(\d{5})[-\s]?(\d{3})\b/.exec(text);
    if (!postal || postal.index === undefined) return null;
    const following = text.slice(postal.index + postal[0].length);
    const number = /(?:,|;|\b(?:n[ºo°.]?|numero|número)\s*[:.-]?)\s*(\d{1,6}[a-z]?)(?!\d)/i.exec(following);
    return number ? { postalCode: `${postal[1]}${postal[2]}`, number: number[1]! } : null;
  }

  private isAccountIdentityRoute(lastIntent: string | null, departmentRoute: string | null | undefined): boolean {
    return lastIntent === 'technical_support'
      || lastIntent === 'billing'
      || departmentRoute === 'technical_support'
      || departmentRoute === 'billing';
  }

  async ensureConversation(
    orgId: string,
    channelId: string,
    contactId: string,
  ): Promise<{ conversation: ConversationWithRelations; created: boolean }> {
    const existing = await this.prisma.prismaSystem.conversation.findFirst({
      where: { orgId, channelId, contactId, status: { not: ConversationStatus.RESOLVED } },
      include: conversationInclude,
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return { conversation: existing, created: false };
    }

    const [stage, department] = await Promise.all([
      this.resolveDefaultStage(orgId),
      this.prisma.prismaSystem.department.findFirst({
        where: { orgId, isDefault: true, isActive: true },
        select: { id: true },
      }),
    ]);
    const stagePosition = stage ? await this.topOfStagePosition(orgId, stage.id) : 0;

    const conversation = await this.prisma.prismaSystem.conversation.create({
      data: {
        protocol: createConversationProtocol(),
        orgId,
        channelId,
        contactId,
        status: ConversationStatus.OPEN,
        stageId: stage?.id ?? null,
        departmentId: department?.id ?? null,
        stagePosition,
      },
      include: conversationInclude,
    });
    return { conversation, created: true };
  }

  /** Follow-up nunca pode impedir a chegada, persistência ou resposta ao cliente. */
  private async observeFollowUp(
    orgId: string,
    conversationId: string,
    contactId: string,
    content: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.followUp.observeInbound({
        orgId,
        conversationId,
        contactId,
        content,
      });
    } catch (error) {
      this.logger.warn(
        `Observação de follow-up falhou para conversa ${conversationId}: ${(error as Error).message}`,
      );
    }
  }

  private async persistMessage(
    input: InboundIngestInput,
    conversationId: string,
  ): Promise<MessageWithAuthor | null> {
    const preview = messagePreview(input.type, input.content);
    try {
      return await this.prisma.prismaSystem.$transaction(async (tx) => {
        const created = await tx.message.create({
          data: {
            orgId: input.orgId,
            conversationId,
            direction: MessageDirection.INBOUND,
            type: input.type,
            content: input.content as Prisma.InputJsonValue,
            // INBOUND já chegou até nós — DELIVERED (status PENDING/SENT são do outbound)
            status: MessageStatus.DELIVERED,
            externalId: input.externalMessageId ?? null,
          },
          include: messageInclude,
        });
        await tx.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessageAt: created.createdAt,
            lastMessagePreview: preview,
            unreadCount: { increment: 1 },
            status: ConversationStatus.OPEN, // mensagem nova reabre SNOOZED/PENDING
          },
        });
        return created;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        this.logger.warn(
          `wamid duplicado em corrida (org=${input.orgId}, externalId=${input.externalMessageId ?? '?'})`,
        );
        return null;
      }
      throw error;
    }
  }

  private async findOrCreateContact(
    input: Pick<
      InboundIngestInput,
      'orgId' | 'externalContactId' | 'contactName' | 'contactPhone' | 'contactAvatarUrl'
      | 'rejectAmbiguousPhoneMatch'
    >,
  ): Promise<Contact> {
    const phone = input.contactPhone ? canonicalPhone(input.contactPhone) : null;
    const phoneCandidates = phone ? phoneLookupCandidates(phone) : [];
    if (phoneCandidates.length > 0) {
      const match = await this.resolveContactByPhone(input.orgId, phoneCandidates);
      if (match.contact) {
        return match.contact;
      }
      if (match.ambiguous && input.rejectAmbiguousPhoneMatch) {
        throw new AmbiguousContactPhoneError();
      }
    }

    try {
      return await this.prisma.prismaSystem.contact.create({
        data: {
          orgId: input.orgId,
          name: input.contactName?.trim() || phone || DEFAULT_CONTACT_NAME,
          phone,
          avatarUrl: input.contactAvatarUrl ?? null,
        },
      });
    } catch (error) {
      // corrida no unique(orgId, phone): outro worker criou — usa o existente
      if (this.isUniqueViolation(error) && phoneCandidates.length > 0) {
        const match = await this.resolveContactByPhone(input.orgId, phoneCandidates);
        if (match.contact) {
          return match.contact;
        }
        if (match.ambiguous && input.rejectAmbiguousPhoneMatch) {
          throw new AmbiguousContactPhoneError();
        }
      }
      throw error;
    }
  }

  /**
   * A base histórica tem telefones recebidos por canais diferentes: E.164 do
   * WhatsApp, número local e valores com máscara. Comparamos somente os
   * dígitos e exigimos um único resultado. Quem chama em modo estrito recebe
   * a ambiguidade e não cria outro contato; assim o histórico não se fragmenta.
   */
  private async resolveContactByPhone(
    orgId: string,
    candidates: string[],
  ): Promise<{ contact: Contact | null; ambiguous: boolean }> {
    const exact = await this.prisma.prismaSystem.contact.findMany({
      where: { orgId, phone: { in: candidates } },
      take: 2,
    });
    if (exact.length === 1) return { contact: exact[0]!, ambiguous: false };
    if (exact.length > 1) return { contact: null, ambiguous: true };

    const digits = [...new Set(candidates.map((candidate) => candidate.replace(/\D/g, '')).filter(Boolean))];
    if (digits.length === 0) return { contact: null, ambiguous: false };
    const matches = await this.prisma.prismaSystem.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT id
      FROM contacts
      WHERE org_id = ${orgId}
        AND phone IS NOT NULL
        AND regexp_replace(phone, '[^0-9]', '', 'g') IN (${Prisma.join(digits)})
      LIMIT 2
    `);
    if (matches.length === 0) return { contact: null, ambiguous: false };
    if (matches.length > 1) return { contact: null, ambiguous: true };
    return {
      contact: await this.prisma.prismaSystem.contact.findUnique({ where: { id: matches[0]!.id } }),
      ambiguous: false,
    };
  }

  private async resolveDefaultStage(orgId: string) {
    const defaultStage = await this.prisma.prismaSystem.pipelineStage.findFirst({
      where: { orgId, isDefault: true },
      orderBy: { position: 'asc' },
    });
    if (defaultStage) {
      return defaultStage;
    }
    return this.prisma.prismaSystem.pipelineStage.findFirst({
      where: { orgId },
      orderBy: { position: 'asc' },
    });
  }

  private async topOfStagePosition(orgId: string, stageId: string): Promise<number> {
    const min = await this.prisma.prismaSystem.conversation.aggregate({
      where: { orgId, stageId },
      _min: { stagePosition: true },
    });
    return (min._min.stagePosition ?? 0) - STAGE_POSITION_GAP;
  }

  private async emitMessageNew(
    orgId: string,
    conversationId: string,
    message: MessageWithAuthor,
  ): Promise<void> {
    const conversation = await this.prisma.prismaSystem.conversation.findFirst({
      where: { id: conversationId, orgId },
      include: conversationInclude,
    });
    if (!conversation) {
      return;
    }
    this.realtime.emitMessageNew(orgId, {
      message: toMessageDto(message),
      conversation: toConversationDto(conversation),
    });
  }

  /**
   * Mantém cada mensagem persistida, mas posterga a resposta por uma janela curta.
   * O processor descarta jobs antigos da mesma conversa; mensagens em sequência
   * geram uma única chamada de IA sem perder auditoria nem automações.
   */
  private async enqueueCoalescedReply(
    orgId: string,
    conversationId: string,
    messageId: string,
  ): Promise<void> {
    const configuredDelay = this.config.get('AI_REPLY_DEBOUNCE_MS', { infer: true });
    const delay = configuredDelay === 0 ? 0 : Math.max(6_000, Math.min(10_000, configuredDelay));
    await this.aiReplyQueue.add(
      'reply',
      { orgId, conversationId, messageId, coalesce: true },
      { delay },
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
