import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ListingService } from './listing.service';
import { CurrentUser, JwtAuthGuard, PlatformAdminGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';

// Dịch vụ trên Marketplace (cần đăng nhập)
@UseGuards(JwtAuthGuard)
@Controller('api/listings')
export class ListingController {
  constructor(private readonly listings: ListingService) {}

  // Dịch vụ đã duyệt (tab "Các dịch vụ")
  @Get()
  list() {
    return this.listings.publicList();
  }

  // Dịch vụ của nhà cung cấp đang đăng nhập (tab "Quản lý dịch vụ")
  @Get('mine')
  mine(@CurrentUser() user: AuthUser) {
    return this.listings.mine(user);
  }

  @Get(':id')
  one(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.listings.getOne(id, user);
  }

  // { title, category, description, website, priceNote, challengeWindowHours, kpis[], submit? }
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.listings.create(user, body);
  }

  @Put(':id')
  update(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: any) {
    return this.listings.update(user, id, body);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.listings.submit(user, id);
  }
}

// Admin nền tảng duyệt dịch vụ
@UseGuards(PlatformAdminGuard)
@Controller('api/admin/listings')
export class AdminListingController {
  constructor(private readonly listings: ListingService) {}

  // ?status=PENDING | APPROVED | REJECTED | ALL
  @Get()
  list(@Query('status') status?: string) {
    return this.listings.adminList(status);
  }

  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.listings.review(user, id, 'APPROVE')
  }

  // { reason }
  @Post(':id/reject')
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: { reason: string }) {
    return this.listings.review(user, id, 'REJECT', body?.reason);
  }
}
