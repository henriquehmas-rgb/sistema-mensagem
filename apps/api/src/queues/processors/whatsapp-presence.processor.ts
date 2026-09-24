import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { MessageDirection } from '@prisma/client';
import type { Job } from 'bullmq';
import { MetaGraphService } from '../../channels/meta-graph.service';
import { OMNI_OPERATIONAL_POLICY } from '../../operational-policy/omni-operational-policy';
import { PrismaService } from '../../prisma/prisma.service';
import { QUEUES, type WhatsappPresenceJob } from '../queues.constants';

/** Fila independente: uma bolha em digitação não atrasa o recibo do próximo inbound. */
@Processor(QUEUES.WHATSAPP_PRESENCE)
export class WhatsappPresenceProcessor extends WorkerHost {
  private readonly logger = new Logger(WhatsappPresenceProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly metaGraph: MetaGraphService,
  ) {
    super();
  }

  async process(job: Job<WhatsappPresenceJob>): Promise<void> {
    const { orgId, messageId } = job.data;
    const inbound = await this.prisma.prismaSystem.message.findFirst({
      where: { id: messageId, orgId, direction: MessageDirection.INBOUND },
      select: { externalId: true, conversation: { select: { channelId: true } } },
    });
    if (!inbound?.externalId?.startsWith('wamid.')) return;
    const channel = await this.prisma.prismaSystem.channel.findFirst({
      where: { id: inbound.conversation.channelId, orgId },
    });
    if (!channel || channel.type !== 'WHATSAPP'
      || !OMNI_OPERATIONAL_POLICY.externalChannelDeliveryEnabled
      || !channel.externalId
      || !OMNI_OPERATIONAL_POLICY.externalChannelDeliveryAllowedExternalIds.includes(channel.externalId)) return;
    const credentials = this.metaGraph.decryptCredentials(channel);
    if (!credentials) return;
    try {
      await this.metaGraph.setWhatsAppReadState({
        ...credentials,
        phoneNumberId: typeof credentials.phoneNumberId === 'string' && credentials.phoneNumberId
          ? credentials.phoneNumberId : channel.externalId,
      }, inbound.externalId, false);
    } catch {
      this.logger.warn('Recibo de leitura WhatsApp indisponivel; resposta continua normalmente');
    }
  }
}
