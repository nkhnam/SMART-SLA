import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SigningService } from './signing.service';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';

// Ký hợp đồng bằng chữ ký điện tử EIP-712 (cần đăng nhập, phải là 1 bên của hợp đồng)
@UseGuards(JwtAuthGuard)
@Controller('api/contracts')
export class SigningController {
  constructor(private readonly signing: SigningService) {}

  // Trạng thái ký 2 bên + nội dung cần ký (toSign) của bên mình
  @Get(':id/signing')
  status(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.signing.getStatus(id, user);
  }

  // Bước 1 - khai báo ví người ký: { walletAddress: "0x..." }
  @Post(':id/signer')
  declare(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: { walletAddress: string }) {
    return this.signing.declareWallet(id, user, body?.walletAddress);
  }

  // Bước 2 - gửi chữ ký từ ví: { signature: "0x...", issuedAt: <số trong toSign.message.issuedAt> }
  @Post(':id/sign')
  sign(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { signature: string; issuedAt: number },
    @Req() req: any,
  ) {
    return this.signing.submitSignature(id, user, body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  // Ký bằng OTP email (khách không có ví) - Bước 1: gửi mã tới email tài khoản đang đăng nhập
  @Post(':id/sign-otp/request')
  requestOtp(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.signing.requestOtp(id, user);
  }

  // Bước 2: nhập mã 6 số { code: "123456" }
  @Post(':id/sign-otp/verify')
  verifyOtp(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: { code: string }, @Req() req: any) {
    return this.signing.verifyOtp(id, user, body?.code, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }
}
