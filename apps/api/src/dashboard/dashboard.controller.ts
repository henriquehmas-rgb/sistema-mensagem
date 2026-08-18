import { Controller, Get } from '@nestjs/common';
import { DashboardService, type DashboardMetricsDto } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('metrics')
  metrics(): Promise<DashboardMetricsDto> {
    return this.dashboardService.metrics();
  }
}
