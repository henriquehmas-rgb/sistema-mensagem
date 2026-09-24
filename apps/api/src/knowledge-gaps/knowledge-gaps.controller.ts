import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { AnswerKnowledgeGapDto } from './dto/answer-knowledge-gap.dto';
import { DismissKnowledgeGapDto } from './dto/dismiss-knowledge-gap.dto';
import { ListKnowledgeGapsQuery } from './dto/list-knowledge-gaps.query';
import { KnowledgeGapsService } from './knowledge-gaps.service';

@Controller('knowledge-gaps')
export class KnowledgeGapsController {
  constructor(private readonly gaps: KnowledgeGapsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: ListKnowledgeGapsQuery) {
    return this.gaps.list(user, query.status);
  }

  @Post(':id/answer')
  answer(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: AnswerKnowledgeGapDto) {
    return this.gaps.answer(id, user, dto.answer);
  }

  @Post(':id/dismiss')
  dismiss(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() dto: DismissKnowledgeGapDto) {
    return this.gaps.dismiss(id, user, dto.note);
  }
}
