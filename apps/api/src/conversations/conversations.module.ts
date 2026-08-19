import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

/**
 * QueueModule importado para @InjectQueue(QUEUES.MEMORY_SUMMARIZE) em
 * ConversationsService (CONTRACTS §15 — gatilho no update para RESOLVED).
 */
@Module({
  imports: [QueueModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
