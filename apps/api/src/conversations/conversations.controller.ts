import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import type { ConversationDto, PaginatedDto } from '../common/serializers';
import { ConversationsService } from './conversations.service';
import { AddTagDto } from './dto/add-tag.dto';
import { ListConversationsQuery } from './dto/list-conversations.query';
import { MoveConversationDto } from './dto/move-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  list(@Query() query: ListConversationsQuery): Promise<PaginatedDto<ConversationDto>> {
    return this.conversationsService.list(query);
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<ConversationDto> {
    return this.conversationsService.get(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateConversationDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ConversationDto> {
    return this.conversationsService.update(id, dto, actor);
  }

  @Post(':id/tags')
  @HttpCode(HttpStatus.OK)
  addTag(@Param('id') id: string, @Body() dto: AddTagDto): Promise<ConversationDto> {
    return this.conversationsService.addTag(id, dto.tagId);
  }

  @Delete(':id/tags/:tagId')
  @HttpCode(HttpStatus.OK)
  removeTag(@Param('id') id: string, @Param('tagId') tagId: string): Promise<ConversationDto> {
    return this.conversationsService.removeTag(id, tagId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  markRead(@Param('id') id: string): Promise<ConversationDto> {
    return this.conversationsService.markRead(id);
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.OK)
  move(
    @Param('id') id: string,
    @Body() dto: MoveConversationDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ConversationDto> {
    return this.conversationsService.move(id, dto, actor);
  }
}
