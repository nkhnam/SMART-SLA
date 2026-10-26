import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { CurrentUser, JwtAuthGuard, Roles } from './auth.guard';
import type { AuthUser } from './auth.guard';

// ThrottlerGuard: vượt giới hạn -> lỗi 429 "Too Many Requests"
@UseGuards(ThrottlerGuard)
@Controller('api/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  // { email, password, fullName, orgName, accountType: "BUYER" | "SUPPLIER", serviceType? }
  // Tối đa 3 lần đăng ký / phút / IP (chống tạo tài khoản rác)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('register')
  register(@Body() body: any) {
    return this.auth.register(body);
  }

  // { email, password } -> { accessToken, user }
  // Tối đa 5 lần đăng nhập / phút / IP (chống dò mật khẩu)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() body: any) {
    return this.auth.login(body);
  }

  // Thông tin người đang đăng nhập
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  // Tự sửa hồ sơ: { fullName?, jobTitle?, currentPassword?, newPassword? }
  // Giới hạn 10 lần / phút (chống dò mật khẩu hiện tại)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  @Put('me')
  updateMe(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.auth.updateProfile(user, body);
  }

  // Danh sách thành viên cùng doanh nghiệp
  @UseGuards(JwtAuthGuard)
  @Get('members')
  members(@CurrentUser() user: AuthUser) {
    return this.auth.listMembers(user);
  }

  // Admin thêm thành viên: { email, password, fullName, role: ADMIN|OPERATIONS|LEGAL|PM }
  @UseGuards(JwtAuthGuard)
  @Roles('ADMIN')
  @Post('members')
  addMember(@CurrentUser() user: AuthUser, @Body() body: any) {
    return this.auth.createMember(user, body);
  }
}
