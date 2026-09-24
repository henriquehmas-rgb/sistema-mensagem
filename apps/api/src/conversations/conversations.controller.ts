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
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import type { ConversationDto, PaginatedDto } from '../common/serializers';
import { ConversationsService } from './conversations.service';
import { AddTagDto } from './dto/add-tag.dto';
import { ListConversationsQuery } from './dto/list-conversations.query';
import { MoveConversationDto } from './dto/move-conversation.dto';
import { UpdateConversationDto } from './dto/update-conversation.dto';
import { VerifyIdentityDto } from './dto/verify-identity.dto';

@Controller('conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Get()
  list(
    @Query() query: ListConversationsQuery,
    @CurrentUser() actor: AuthUser,
  ): Promise<PaginatedDto<ConversationDto>> {
    return this.conversationsService.list(query, actor);
  }

  @Post('triage/backfill')
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  backfillTriage(): Promise<{ processed: number; updated: number; skipped: number; failed: number; remaining: number }> {
    return this.conversationsService.backfillTriage();
  }

  @Post(':id/claim')
  @HttpCode(HttpStatus.OK)
  claim(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ConversationDto> {
    return this.conversationsService.claim(id, actor);
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() actor: AuthUser): Promise<ConversationDto> {
    return this.conversationsService.get(id, actor);
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

  @Post(':id/identity/verify')
  @Roles('ADMIN', 'SUPERVISOR')
  @HttpCode(HttpStatus.OK)
  verifyIdentity(
    @Param('id') id: string,
    @Body() dto: VerifyIdentityDto,
    @CurrentUser() actor: AuthUser,
  ): Promise<ConversationDto> {
    return this.conversationsService.verifyIdentity(id, dto.method, actor);
  }

  @Post(':id/identity/revoke')
  @Roles('ADMIN', 'SUPERVISOR')
  @HttpCode(HttpStatus.OK)
  revokeIdentity(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ): Promise<ConversationDto> {
    return this.conversationsService.revokeIdentity(id, actor);
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
