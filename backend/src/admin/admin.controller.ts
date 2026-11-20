import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { PlatformAdminGuard } from '../auth/auth.guard';
import { AdminService } from './admin.service';

// API dành riêng cho admin nền tảng SMART_SLA
@UseGuards(PlatformAdminGuard)
@Controller('api/admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('users')
  users() {
    return this.admin.listUsers();
  }

  @Get('revenue')
  revenue() {
    return this.admin.revenue();
  }

  // Gửi lại 1 giao dịch với cùng mã idempotency để chứng minh không bị ghi trùng
  @Post('payments/:id/replay')
  replay(@Param('id') id: string) {
    return this.admin.replay(id);
  }
}
