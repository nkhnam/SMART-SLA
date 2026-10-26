import { Body, Controller, Get, HttpException, Post, UseGuards } from '@nestjs/common';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { OracleService } from './oracle.service';

const HEALTH_PATH = '/api/demo-provider/health';

// "Nhà cung cấp mẫu" để demo cho BGK:
// Oracle giám sát endpoint này bằng HTTP thật; ta chủ động bật/tắt sự cố để xem hệ thống phản ứng.
let outage = false; // true -> trả lỗi 503 (dịch vụ sập)
let extraDelayMs = 0; // > 0 -> trả lời chậm (vi phạm thời gian phản hồi)

@Controller('api/demo-provider')
export class DemoProviderController {
  constructor(private oracle: OracleService) {}

  // Endpoint được giám sát
  @Get('health')
  async health() {
    if (extraDelayMs > 0) await new Promise((r) => setTimeout(r, extraDelayMs));
    if (outage) throw new HttpException({ status: 'DOWN', message: 'Dịch vụ đang gặp sự cố' }, 503);
    return { status: 'UP', service: 'Demo Cloud Hosting', time: new Date().toISOString() };
  }

  // Xem trạng thái hiện tại
  @Get('state')
  state() {
    return { outage, extraDelayMs };
  }

  // Bật/tắt sự cố (cần đăng nhập): body { "outage": true, "delayMs": 0 }
  @UseGuards(JwtAuthGuard)
  @Post('state')
  async setState(@Body() body: { outage?: boolean; delayMs?: number }) {
    if (typeof body?.outage === 'boolean') outage = body.outage;
    if (body?.delayMs !== undefined) extraDelayMs = Math.min(Math.max(Number(body.delayMs) || 0, 0), 4000);
    // Đo ngay các hợp đồng đang theo dõi URL demo: đoạn sự cố mở / đóng tức thì, không chờ vòng quét
    const probed = await this.oracle.probeNowByPath(HEALTH_PATH).catch(() => 0);
    return { outage, extraDelayMs, probed };
  }

  // Hợp đồng của bạn đang giám sát URL demo + kết quả lần đo gần nhất
  @UseGuards(JwtAuthGuard)
  @Get('watchers')
  watchers(@CurrentUser() user: AuthUser) {
    return this.oracle.watchersByPath(HEALTH_PATH, user.orgId);
  }
}
