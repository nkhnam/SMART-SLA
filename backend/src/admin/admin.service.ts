import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../billing/plan.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private plans: PlanService,
  ) {}

  // Danh sách người dùng cho màn hình "Quản lý gói dịch vụ" (gói tính theo doanh nghiệp)
  async listUsers() {
    const users = await this.prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: true,
        isActive: true,
        createdAt: true,
        organization: { select: { id: true, name: true, orgType: true, createdAt: true } },
      },
    });

    const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const stateCache = new Map<string, Awaited<ReturnType<PlanService['getState']>>>();
    const paidOrgs = new Set(
      (await this.prisma.paymentTransaction.findMany({ where: { status: 'PAID', amountVnd: { gt: 0 } }, select: { organizationId: true } })).map(
        (t) => t.organizationId,
      ),
    );

    return Promise.all(
      users.map(async (u) => {
        let st = stateCache.get(u.organization.id);
        if (!st) {
          st = await this.plans.getState(u.organization.id);
          stateCache.set(u.organization.id, st);
        }
        // Mã gói hiển thị: PLATFORM | NONE | <gói> | EXPIRED
        const code = st.status === 'PLATFORM' ? 'PLATFORM' : st.status === 'NONE' ? 'NONE' : st.status === 'EXPIRED' ? 'EXPIRED' : st.code!;
        const paymentStatus =
          st.status === 'PLATFORM'
            ? 'EXEMPT'
            : st.status === 'EXPIRED'
              ? 'OVERDUE'
              : st.code === 'PILOT'
                ? 'FREE'
                : st.status === 'ACTIVE' && (paidOrgs.has(u.organization.id) || st.code === 'PAYG')
                  ? 'PAID'
                  : 'NONE';
        return {
          ...u,
          platformAdmin: adminEmails.includes(u.email.toLowerCase()),
          plan: {
            code,
            name: st.name,
            planCode: st.code,
            startedAt: st.startedAt,
            expiresAt: st.expiresAt,
            daysLeft: st.expiresAt ? Math.max(0, Math.ceil((st.expiresAt.getTime() - Date.now()) / 86_400_000)) : null,
          },
          paymentStatus,
        };
      }),
    );
  }

  // Doanh thu (demo): tổng hợp + lịch sử giao dịch
  async revenue() {
    const txs = await this.prisma.paymentTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { organization: { select: { name: true } } },
    });
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const paid = txs.filter((t) => t.status === 'PAID');
    return {
      summary: {
        total: paid.reduce((a, t) => a + t.amountVnd, 0),
        thisMonth: paid.filter((t) => t.createdAt >= monthStart).reduce((a, t) => a + t.amountVnd, 0),
        paidCount: paid.length,
        pendingCount: txs.filter((t) => t.status === 'PENDING').length,
      },
      transactions: txs,
    };
  }

  // Demo idempotency: gửi lại ĐÚNG yêu cầu đăng ký cũ (cùng mã idempotency). Kết quả phải là "replayed", không tạo giao dịch mới.
  async replay(txId: string) {
    const tx = await this.prisma.paymentTransaction.findUnique({ where: { id: txId } });
    if (!tx) throw new NotFoundException('Không tìm thấy giao dịch');
    const before = await this.prisma.paymentTransaction.count();
    if (tx.kind === 'PER_CONTRACT' && tx.contractId) {
      const st = await this.plans.getState(tx.organizationId);
      await this.plans.chargePerContract(tx.organizationId, tx.userId, tx.contractId, '', { ...st, limits: { ...st.limits, perContractVnd: tx.amountVnd } });
    } else {
      await this.plans.subscribe(tx.organizationId, tx.userId, tx.planCode, tx.idempotencyKey);
    }
    const after = await this.prisma.paymentTransaction.count();
    return {
      idempotencyKey: tx.idempotencyKey,
      newTransactions: after - before,
      message:
        after === before
          ? 'Đã gửi lại yêu cầu cùng mã idempotency: hệ thống trả kết quả cũ, KHÔNG tạo giao dịch mới, KHÔNG cộng thêm thời hạn gói.'
          : 'Cảnh báo: đã phát sinh giao dịch mới!',
    };
  }
}
