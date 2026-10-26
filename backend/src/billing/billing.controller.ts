import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { PlanService } from './plan.service';
import { PLAN_ORDER, PLANS } from './plans';

// Danh sách gói: công khai (khách chưa đăng nhập cũng xem được trang Gói dịch vụ)
@Controller('api/billing')
export class BillingPublicController {
  @Get('plans')
  plans() {
    return PLAN_ORDER.map((c) => PLANS[c]);
  }
}

@UseGuards(JwtAuthGuard)
@Controller('api/billing')
export class BillingController {
  constructor(private readonly plans: PlanService) {}

  // Gói hiện tại + số SLA đang dùng
  @Get('me')
  async me(@CurrentUser() user: AuthUser) {
    const state = await this.plans.getState(user.orgId);
    return { ...state, liveSla: await this.plans.countLiveSla(user.orgId) };
  }

  @Get('history')
  history(@CurrentUser() user: AuthUser) {
    return this.plans.history(user.orgId);
  }

  // { planCode, idempotencyKey } - demo: kích hoạt ngay, không thu tiền thật
  @Post('subscribe')
  subscribe(@CurrentUser() user: AuthUser, @Body() body: { planCode: string; idempotencyKey: string }) {
    return this.plans.subscribe(user.orgId, user.userId, body?.planCode, body?.idempotencyKey);
  }
}
