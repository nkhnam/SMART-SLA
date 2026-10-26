import { Global, Logger, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { randomBytes } from 'crypto';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard, PlatformAdminGuard } from './auth.guard';

// Khóa ký JWT lấy từ biến môi trường JWT_SECRET.
// Nếu thiếu: tạo khóa ngẫu nhiên (vẫn an toàn) nhưng mọi phiên đăng nhập sẽ mất khi server khởi động lại.
const secret = process.env.JWT_SECRET || randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  new Logger('AuthModule').warn('Chưa đặt JWT_SECRET -> dùng khóa tạm, phiên đăng nhập sẽ mất khi khởi động lại');
}

@Global()
@Module({
  imports: [
    JwtModule.register({ global: true, secret, signOptions: { expiresIn: '1d' } }),
    // Giới hạn tần suất mặc định cho các API gắn ThrottlerGuard (chỉ dùng ở AuthController)
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 20 }]),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, PlatformAdminGuard],
  exports: [JwtAuthGuard, PlatformAdminGuard],
})
export class AuthModule {}
