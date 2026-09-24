import { Module } from '@nestjs/common';
import { QueueModule } from '../queues/queue.module';
import { FollowUpController } from './follow-up.controller';

@Module({
  imports: [QueueModule],
  controllers: [FollowUpController],
})
export class FollowUpModule {}
