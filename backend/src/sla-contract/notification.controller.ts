import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';

// Thông báo trong web (biểu tượng chuông) - chỉ thấy thông báo của doanh nghiệp mình
@UseGuards(JwtAuthGuard)
@Controller('api/notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  // ?unread=true -> chỉ thông báo chưa đọc
  @Get()
  list(@CurrentUser() user: AuthUser, @Query('unread') unread?: string) {
    return this.notifications.list(user.orgId, unread === 'true');
  }

  @Post('read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.notifications.markAllRead(user.orgId);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.notifications.markRead(user.orgId, id);
  }
}
