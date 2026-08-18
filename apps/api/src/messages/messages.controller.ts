import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import type { MessageDto } from '../common/serializers';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListMessagesQuery } from './dto/list-messages.query';
import { MessagesService, type MessagePageDto } from './messages.service';

@Controller('conversations/:conversationId/messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Get()
  list(
    @Param('conversationId') conversationId: string,
    @Query() query: ListMessagesQuery,
  ): Promise<MessagePageDto> {
    return this.messagesService.list(conversationId, query);
  }

  @Post()
  send(
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateMessageDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<MessageDto> {
    return this.messagesService.send(conversationId, dto, actor);
  }
}
