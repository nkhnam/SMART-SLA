import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ViolationService } from './violation.service';
import { ContractAccessService } from './contract-access.service';
import { CurrentUser, JwtAuthGuard, PlatformAdminGuard, viewerOrThrow } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';

@Controller('api/violations')
export class ViolationController {
  constructor(
    private readonly violationService: ViolationService,
    private readonly access: ContractAccessService,
    private readonly jwt: JwtService,
  ) {}

  // Danh sách vụ vi phạm của các hợp đồng mình là 1 bên (admin nền tảng thấy tất cả). ?status=CHALLENGED
  @Get()
  findAll(@Headers('authorization') auth?: string, @Query('status') status?: string) {
    const viewer = viewerOrThrow(this.jwt, auth);
    return this.violationService.findAll(this.access.scopeWhere(viewer), status?.trim() || undefined);
  }

  // Kiểm chứng bằng chứng vi phạm với blockchain (CÔNG KHAI: chỉ trả hash + kết quả đối chiếu)
  @Get(':id/verify')
  verify(@Param('id') id: string) {
    return this.violationService.verifyEvidence(id);
  }

  // Phản đối (cần đăng nhập, phải là 1 bên của hợp đồng): body { reason: "..." }
  @UseGuards(JwtAuthGuard)
  @Post(':id/challenge')
  challenge(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: { reason: string }) {
    return this.violationService.challenge(id, user, body?.reason);
  }

  // Admin nền tảng xử lý vụ bị phản đối: body { decision: "UPHOLD" | "DISMISS", note: "..." }
  @UseGuards(PlatformAdminGuard)
  @Post(':id/resolve')
  resolve(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { decision: string; note: string },
  ) {
    return this.violationService.resolve(id, user, String(body?.decision ?? '').toUpperCase(), body?.note);
  }
}
