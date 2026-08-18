import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { QUEUES } from '../queues/queues.constants';
import { MediaCleanupProcessor } from './media-cleanup.processor';
import { MediaCleanupScheduler } from './media-cleanup.scheduler';
import { MediaCleanupService } from './media-cleanup.service';
import { MediaController } from './media.controller';
import { MediaService } from './media.service';

/**
 * Mídia re-hospedada (CONTRACTS §6): MediaService (fetchAndStore do re-host de
 * mídia inbound da Meta + resolução segura de caminho) e o controller público
 * GET /api/media/:orgId/:file. O processor `webhook-ingest` (WebhooksModule)
 * consome o MediaService.
 * Fila `media-cleanup` (CONTRACTS §13): job repetível que remove uploads
 * outbound órfãos — registrada aqui (não no QueueModule) porque só este
 * módulo precisa dela, evitando um import cruzado desnecessário.
 * RedisService/PrismaService vêm do RedisModule/PrismaModule (@Global),
 * sem precisar de import explícito aqui.
 */
@Module({
  imports: [BullModule.registerQueue({ name: QUEUES.MEDIA_CLEANUP })],
  controllers: [MediaController],
  providers: [MediaService, MediaCleanupService, MediaCleanupProcessor, MediaCleanupScheduler],
  exports: [MediaService],
})
export class MediaModule {}
