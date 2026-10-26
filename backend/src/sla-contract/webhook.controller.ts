import { BadRequestException, Body, Controller, Headers, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { OracleService } from './oracle.service';

// Cổng nhận sự kiện từ hệ thống giám sát bên ngoài (Datadog, CloudWatch, UptimeRobot...)
@Controller('api/webhooks')
export class WebhookController {
  constructor(private readonly oracleService: OracleService) {}

  // POST /api/webhooks/:contractId?token=...   body: {"status":"DOWN"} hoặc {"status":"UP"}
  // (token cũng có thể gửi qua header "x-sla-token")
  @Post(':contractId')
  async receive(
    @Param('contractId') contractId: string,
    @Query('token') tokenQuery: string,
    @Headers('x-sla-token') tokenHeader: string,
    @Body() body: any,
  ) {
    try {
      return await this.oracleService.receiveWebhook(contractId, tokenHeader || tokenQuery, body);
    } catch (err: any) {
      if (err?.message === 'UNAUTHORIZED') throw new UnauthorizedException('Token webhook không hợp lệ');
      throw new BadRequestException(err?.message);
    }
  }
}
