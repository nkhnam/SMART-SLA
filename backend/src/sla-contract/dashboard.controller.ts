import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { ContractAccessService } from './contract-access.service';
import { TimelineService } from './timeline.service';

@Controller('api/dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(
    private readonly timeline: TimelineService,
    private readonly access: ContractAccessService,
  ) {}

  // Dữ liệu biểu đồ Gantt: ?range=1h | 24h | all. Chỉ hợp đồng mình là 1 bên (admin nền tảng thấy tất cả)
  @Get('timeline')
  get(@CurrentUser() user: AuthUser, @Query('range') range?: string) {
    return this.timeline.timeline(this.access.scopeWhere(user), range ?? '24h');
  }
}
