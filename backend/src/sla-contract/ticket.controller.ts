import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { TicketService } from './ticket.service';
import { NegotiationSummaryService } from './negotiation-summary.service';
import { CurrentUser, JwtAuthGuard } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';

// Ticket + khung chat (cần đăng nhập, phải là 1 bên của hợp đồng)
@UseGuards(JwtAuthGuard)
@Controller('api')
export class TicketController {
  constructor(
    private readonly tickets: TicketService,
    private readonly summary: NegotiationSummaryService,
  ) {}

  // Có bật AI tóm tắt không (để giao diện hiện / ẩn nút)
  @Get('negotiation-summary/enabled')
  summaryEnabled() {
    return { enabled: this.summary.enabled };
  }

  // Tóm tắt luồng bàn bạc điều khoản bằng AI (chỉ gợi ý, con người vẫn sửa điều khoản và ký)
  @Post('contracts/:id/negotiation-summary')
  summarize(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.summary.summarize(id, user);
  }

  // ?kind=SUPPORT | NEGOTIATION
  @Get('contracts/:id/tickets')
  list(@Param('id') id: string, @CurrentUser() user: AuthUser, @Query('kind') kind?: string) {
    return this.tickets.list(id, user, kind);
  }

  // { kind, title, message }
  @Post('contracts/:id/tickets')
  create(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: any) {
    return this.tickets.create(id, user, body);
  }

  @Get('tickets/:ticketId')
  get(@Param('ticketId') ticketId: string, @CurrentUser() user: AuthUser) {
    return this.tickets.get(ticketId, user);
  }

  // { body }
  @Post('tickets/:ticketId/messages')
  message(@Param('ticketId') ticketId: string, @CurrentUser() user: AuthUser, @Body() body: { body: string }) {
    return this.tickets.addMessage(ticketId, user, body?.body);
  }

  // { status: "RESOLVED" | "CLOSED" | "OPEN" }
  @Post('tickets/:ticketId/status')
  status(@Param('ticketId') ticketId: string, @CurrentUser() user: AuthUser, @Body() body: { status: string }) {
    return this.tickets.setStatus(ticketId, user, String(body?.status ?? '').toUpperCase());
  }
}
