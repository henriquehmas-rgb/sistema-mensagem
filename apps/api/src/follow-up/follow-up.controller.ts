import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { ReviewFollowUpDto } from './dto/review-follow-up.dto';
import { ConfigureFollowUpOwnerDto } from './dto/configure-follow-up-owner.dto';
import { FollowUpService } from './follow-up.service';

@Roles('ADMIN', 'SUPERVISOR')
@Controller('follow-ups')
export class FollowUpController {
  constructor(private readonly followUps: FollowUpService) {}

  @Get()
  list(@CurrentUser() actor: AuthUser, @Query('status') status?: string) {
    return this.followUps.list(actor.orgId, status);
  }

  @Get('configuration')
  configuration(@CurrentUser() actor: AuthUser) {
    return this.followUps.configuration(actor.orgId);
  }

  @Roles('ADMIN')
  @Patch('configuration')
  configure(@Body() dto: ConfigureFollowUpOwnerDto, @CurrentUser() actor: AuthUser) {
    return this.followUps.configureResponsible(dto, actor);
  }

  @Patch(':id/review')
  review(@Param('id') id: string, @Body() dto: ReviewFollowUpDto, @CurrentUser() actor: AuthUser) {
    return this.followUps.review(id, dto, actor);
  }
}
