import { BadRequestException, Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/auth.guard';
import { SourceCompareService } from './source-compare.service';
import { OracleService } from './oracle.service';

// Đối chiếu các nguồn dữ liệu KPI (chỉ admin nền tảng): ?minutes=30&contractId=...
@UseGuards(PlatformAdminGuard)
@Controller('api/admin/source-compare')
export class SourceCompareController {
  constructor(private readonly svc: SourceCompareService) {}

  @Get()
  get(@Query('minutes') minutes?: string, @Query('contractId') contractId?: string) {
    return this.svc.compare(minutes, contractId);
  }
}

// Tạm dừng / tiếp tục giám sát 1 hợp đồng (chỉ admin nền tảng; hai bên không tự tạm dừng được)
@UseGuards(PlatformAdminGuard)
@Controller('api/admin/contracts')
export class AdminMonitoringController {
  constructor(private readonly oracle: OracleService) {}

  @Get(':id/monitoring')
  state(@Param('id') id: string) {
    return this.oracle.monitoringState(id);
  }

  // { "enabled": true | false }
  @Post(':id/monitoring')
  async set(@Param('id') id: string, @Body() body: { enabled?: boolean }) {
    try {
      await this.oracle.setMonitoring(id, body?.enabled === true);
      return this.oracle.monitoringState(id);
    } catch (err: any) {
      throw new BadRequestException(err?.message);
    }
  }
}
