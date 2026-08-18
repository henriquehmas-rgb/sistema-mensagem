import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { MetaGraphService } from './meta-graph.service';

/**
 * Canais (CONTRACTS §6): CRUD com credenciais AES-256-GCM + teste de conexão.
 * Exporta MetaGraphService para o processor de outbound (envio Graph API).
 */
@Module({
  controllers: [ChannelsController],
  providers: [ChannelsService, MetaGraphService],
  exports: [MetaGraphService],
})
export class ChannelsModule {}
