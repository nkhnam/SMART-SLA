import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanService } from '../billing/plan.service';
import { PrismaService } from '../prisma/prisma.service';
import { ContractAccessService } from './contract-access.service';
import { AuthUser } from '../auth/auth.guard';

// TICKET + KHUNG CHAT TÍCH HỢP SẴN
//   NEGOTIATION: bàn bạc điều khoản (mỗi hợp đồng 1 luồng, không tính KPI)
//   SUPPORT    : yêu cầu hỗ trợ. SLA_DEX tự ghi mốc thời gian để đo KPI ticket:
//                firstResponseAt = tin nhắn đầu tiên của BÊN KIA (không phải bên mở ticket)
//                resolvedAt      = lúc nhà cung cấp đánh dấu "Đã giải quyết"
const KINDS = ['NEGOTIATION', 'SUPPORT'];
const MAX_BODY = 4000;

@Injectable()
export class TicketService {
  constructor(
    private prisma: PrismaService,
    private access: ContractAccessService,
    private plans: PlanService,
  ) {}

  private async authorName(userId: string) {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    return u?.fullName ?? 'Người dùng';
  }

  private async loadTicket(ticketId: string, user: AuthUser) {
    const t = await this.prisma.ticket.findUnique({ where: { id: ticketId } });
    if (!t) throw new NotFoundException('Không tìm thấy ticket');
    const party = await this.access.assertParty(t.contractId, user.orgId);
    return { t, party };
  }

  async list(contractId: string, user: AuthUser, kind?: string) {
    await this.access.assertParty(contractId, user.orgId);
    return this.prisma.ticket.findMany({
      where: { contractId, ...(kind && KINDS.includes(kind) ? { kind } : {}) },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { messages: true } } },
    });
  }

  async create(contractId: string, user: AuthUser, body: { kind?: string; title?: string; message?: string }) {
    await this.plans.requireActive(user.orgId);
    const party = await this.access.assertParty(contractId, user.orgId);
    const kind = KINDS.includes(String(body?.kind)) ? String(body.kind) : 'SUPPORT';
    const message = String(body?.message ?? '').trim();
    if (!message) throw new BadRequestException('Cần nhập nội dung');
    if (message.length > MAX_BODY) throw new BadRequestException(`Nội dung tối đa ${MAX_BODY} ký tự`);

    // Bàn bạc: mỗi hợp đồng chỉ 1 luồng -> có rồi thì thêm tin nhắn vào luồng đó
    if (kind === 'NEGOTIATION') {
      const existing = await this.prisma.ticket.findFirst({ where: { contractId, kind } });
      if (existing) {
        await this.addMessage(existing.id, user, message);
        return this.get(existing.id, user);
      }
    }

    const title = String(body?.title ?? '').trim().slice(0, 200) || (kind === 'NEGOTIATION' ? 'Bàn bạc điều khoản' : '');
    if (!title) throw new BadRequestException('Cần nhập tiêu đề ticket');

    const ticket = await this.prisma.ticket.create({
      data: {
        contractId,
        kind,
        title,
        status: 'OPEN',
        createdById: user.userId,
        createdByParty: party,
        messages: {
          create: { authorId: user.userId, authorParty: party, authorName: await this.authorName(user.userId), body: message },
        },
      },
    });
    return this.get(ticket.id, user);
  }

  async get(ticketId: string, user: AuthUser) {
    await this.loadTicket(ticketId, user);
    return this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
  }

  async addMessage(ticketId: string, user: AuthUser, rawBody: string) {
    await this.plans.requireActive(user.orgId);
    const { t, party } = await this.loadTicket(ticketId, user);
    const body = String(rawBody ?? '').trim();
    if (!body) throw new BadRequestException('Tin nhắn trống');
    if (body.length > MAX_BODY) throw new BadRequestException(`Tin nhắn tối đa ${MAX_BODY} ký tự`);
    if (t.status === 'CLOSED') throw new BadRequestException('Ticket đã đóng, hãy mở ticket mới');

    const now = new Date();
    await this.prisma.ticketMessage.create({
      data: { ticketId, authorId: user.userId, authorParty: party, authorName: await this.authorName(user.userId), body, createdAt: now },
    });

    // Mốc "phản hồi đầu tiên" chỉ ghi 1 lần, khi BÊN KIA trả lời lần đầu (máy tự ghi, không ai sửa được)
    const data: Record<string, unknown> = { updatedAt: now };
    if (t.kind === 'SUPPORT' && !t.firstResponseAt && party !== t.createdByParty) {
      data.firstResponseAt = now;
      if (t.status === 'OPEN') data.status = 'IN_PROGRESS';
    }
    await this.prisma.ticket.update({ where: { id: ticketId }, data });
    return this.get(ticketId, user);
  }

  // RESOLVED: chỉ nhà cung cấp | CLOSED / mở lại (OPEN): chỉ bên mở ticket
  async setStatus(ticketId: string, user: AuthUser, status: string) {
    await this.plans.requireActive(user.orgId);
    const { t, party } = await this.loadTicket(ticketId, user);
    if (t.kind !== 'SUPPORT') throw new BadRequestException('Luồng bàn bạc không có trạng thái');

    if (status === 'RESOLVED') {
      if (party !== 'SUPPLIER') throw new ForbiddenException('Chỉ nhà cung cấp mới đánh dấu đã giải quyết');
      if (!['OPEN', 'IN_PROGRESS'].includes(t.status)) throw new BadRequestException('Ticket không ở trạng thái đang xử lý');
      const now = new Date();
      await this.prisma.ticket.update({
        where: { id: ticketId },
        data: { status: 'RESOLVED', resolvedAt: now, firstResponseAt: t.firstResponseAt ?? now },
      });
    } else if (status === 'CLOSED' || status === 'OPEN') {
      if (party !== t.createdByParty) throw new ForbiddenException('Chỉ bên mở ticket mới đóng hoặc mở lại');
      if (t.status !== 'RESOLVED') throw new BadRequestException('Chỉ đóng hoặc mở lại ticket đã được giải quyết');
      await this.prisma.ticket.update({
        where: { id: ticketId },
        // Mở lại: xoá mốc giải quyết -> thời gian xử lý tiếp tục được tính
        data: status === 'CLOSED' ? { status: 'CLOSED' } : { status: 'IN_PROGRESS', resolvedAt: null },
      });
    } else {
      throw new BadRequestException('Trạng thái không hợp lệ');
    }
    return this.get(ticketId, user);
  }
}
