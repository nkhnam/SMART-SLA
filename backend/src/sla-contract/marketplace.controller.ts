import { Body, Controller, Get, Param, Put, Query, UseGuards } from '@nestjs/common';
import { MarketplaceService } from './marketplace.service';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';

@Controller('api/marketplace')
export class MarketplaceController {
  constructor(private readonly marketplace: MarketplaceService) {}

  // Danh sách nhà cung cấp + điểm uy tín: ?q=tên&serviceType=loại
  @Get('providers')
  list(@Query('q') q?: string, @Query('serviceType') serviceType?: string) {
    return this.marketplace.list(q?.trim() || undefined, serviceType?.trim() || undefined);
  }

  // Hồ sơ hiệu suất chi tiết của 1 nhà cung cấp
  @Get('providers/:id')
  detail(@Param('id') id: string) {
    return this.marketplace.detail(id);
  }

  // Nhà cung cấp tự cập nhật giới thiệu: { serviceType?, description?, website? }
  @UseGuards(JwtAuthGuard)
  @Put('profile')
  updateProfile(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.marketplace.updateMyProfile(user, body);
  }
}
