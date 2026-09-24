import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { ReviewOperationalActionDto } from './dto/review-operational-action.dto';
import { SimulateOperationalActionDto } from './dto/simulate-operational-action.dto';
import { OperationalActionsService } from './operational-actions.service';

@Roles('ADMIN', 'SUPERVISOR')
@Controller('operational-actions')
export class OperationalActionsController {
  constructor(private readonly actions: OperationalActionsService) {}

  @Get('homologation-plan')
  homologationPlan() {
    return this.actions.homologationPlan();
  }

  @Get('policy')
  policy() {
    return this.actions.homologationPlan().policy;
  }

  @Post('simulate')
  simulate(@Body() dto: SimulateOperationalActionDto) {
    return this.actions.simulate(dto);
  }

  @Post('proposals')
  createProposal(@Body() dto: SimulateOperationalActionDto, @CurrentUser() actor: AuthUser) {
    return this.actions.createProposal(dto, actor.userId);
  }

  @Get('proposals')
  listProposals(@Query('status') status?: string) {
    return this.actions.listProposals(status);
  }

  @Patch('proposals/:id/review')
  reviewProposal(
    @Param('id') id: string,
    @Body() dto: ReviewOperationalActionDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.actions.reviewProposal(id, dto, actor.userId);
  }
}
