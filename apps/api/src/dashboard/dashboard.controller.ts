import { Body, Controller, Get, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { AuthUser } from '../auth/interfaces/auth-user.interface';
import { CreateReadinessSnapshotDto } from './dto/create-readiness-snapshot.dto';
import { DashboardService, type DashboardMetricsDto } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('metrics')
  metrics(): Promise<DashboardMetricsDto> {
    return this.dashboardService.metrics();
  }

  /** Leitura única com operação e integração em blocos separados. */
  @Get('readiness')
  readiness() {
    return this.dashboardService.readiness();
  }

  /** Apenas liderança registra ou revisa marcos comparáveis de prontidão. */
  @Roles('ADMIN', 'SUPERVISOR')
  @Get('readiness/snapshots')
  snapshots() {
    return this.dashboardService.listReadinessSnapshots();
  }

  @Roles('ADMIN', 'SUPERVISOR')
  @Post('readiness/snapshots')
  createSnapshot(@CurrentUser() actor: AuthUser, @Body() dto: CreateReadinessSnapshotDto) {
    return this.dashboardService.createReadinessSnapshot(actor, dto);
  }
}
