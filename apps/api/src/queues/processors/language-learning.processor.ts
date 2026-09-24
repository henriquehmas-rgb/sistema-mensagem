import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ConversationStatus, MessageDirection, MessageType } from '@prisma/client';
import type { Job } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { learnSocialVariants, type LanguageSample } from '../language-variants';
import { QUEUES } from '../queues.constants';

const ROUTES = ['technical_support', 'billing', 'sales'] as const;

@Processor(QUEUES.LANGUAGE_LEARNING)
export class LanguageLearningProcessor extends WorkerHost {
  private readonly logger = new Logger(LanguageLearningProcessor.name);

  constructor(private readonly prisma: PrismaService) { super(); }

  async process(_job: Job): Promise<void> {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000);
    let orgCursor: string | undefined;
    do {
      const orgs = await this.prisma.prismaSystem.organization.findMany({
        select: { id: true }, orderBy: { id: 'asc' }, take: 50,
        ...(orgCursor ? { cursor: { id: orgCursor }, skip: 1 } : {}),
      });
      for (const org of orgs) {
        const samples: LanguageSample[] = [];
        let conversationCursor: string | undefined;
        let scanned = 0;
        do {
          const conversations = await this.prisma.prismaSystem.conversation.findMany({
            where: {
              orgId: org.id,
              status: ConversationStatus.RESOLVED,
              createdAt: { gte: since },
              lastIntent: { in: [...ROUTES] },
              triageConflict: false,
              triageConfidence: { gte: 0.85 },
            },
            select: {
              id: true, lastIntent: true,
              messages: {
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 4,
                select: { direction: true, type: true, content: true },
              },
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 100,
            ...(conversationCursor ? { cursor: { id: conversationCursor }, skip: 1 } : {}),
          });
          scanned += conversations.length;
          for (const conversation of conversations) {
            const route = conversation.lastIntent;
            if (!ROUTES.some((allowed) => allowed === route)) continue;
            const openingMessages: string[] = [];
            for (const message of conversation.messages) {
              if (message.direction !== MessageDirection.INBOUND || message.type !== MessageType.TEXT) break;
              const content = message.content as Record<string, unknown>;
              if (typeof content.text !== 'string') break;
              openingMessages.push(content.text);
              if (openingMessages.length === 2) break;
            }
            if (openingMessages.length) {
              samples.push({ conversationId: conversation.id, route: route as LanguageSample['route'], openingMessages });
            }
          }
          conversationCursor = conversations.at(-1)?.id;
          if (conversations.length < 100 || scanned >= 1_000) break;
        } while (conversationCursor);

        const learned = learnSocialVariants(samples);
        for (const variant of learned) {
          await this.prisma.prismaSystem.languageVariant.upsert({
            where: { orgId_normalizedText_kind: {
              orgId: org.id, normalizedText: variant.normalizedText, kind: 'SOCIAL_GREETING',
            } },
            create: {
              orgId: org.id, normalizedText: variant.normalizedText, kind: 'SOCIAL_GREETING',
              status: 'ACTIVE', evidenceCount: variant.evidenceCount, routeCount: variant.routeCount,
            },
            update: { evidenceCount: variant.evidenceCount, routeCount: variant.routeCount },
          });
        }
        if (learned.length) this.logger.log(`Variações sociais aprovadas em lote: org=${org.id}, count=${learned.length}`);
      }
      orgCursor = orgs.at(-1)?.id;
      if (orgs.length < 50) break;
    } while (orgCursor);
  }
}
