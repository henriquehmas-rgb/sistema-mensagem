import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module';
import { TemplatesController } from './templates.controller';
import { TemplatesService } from './templates.service';

/**
 * Templates de mensagem do WhatsApp (CONTRACTS §12) — sincronização via
 * MetaGraphService (exportado por ChannelsModule) + listagem tenant-scoped.
 */
@Module({
  imports: [ChannelsModule],
  controllers: [TemplatesController],
  providers: [TemplatesService],
})
export class TemplatesModule {}
