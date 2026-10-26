import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PLANS, PlanCode, PlanDef } from './plans';

// Hợp đồng đang "chiếm suất" của gói
const LIVE_STATUSES = ['PENDING_SIGNATURE', 'ACTIVE', 'WARNING', 'VIOLATED'];
// Demo: ép chu kỳ đo cho mọi gói (VD 30) để không phải chờ 15 phút. Không đặt -> theo gói.
const PROBE_OVERRIDE_SECONDS = Number(process.env.ORACLE_PROBE_INTERVAL_SECONDS) || 0;

const adminEmails = () =>
  (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

export type PlanState = {
  code: PlanCode | 'PLATFORM' | null;
  name: string;
  active: boolean;
  status: 'ACTIVE' | 'EXPIRED' | 'NONE' | 'PLATFORM';
  startedAt: Date | null;
  expiresAt: Date | null;
  pilotUsed: boolean;
  limits: {
    maxActiveSla: number | null;
    maxSourcesPerContract: number | null;
    probeIntervalSeconds: number;
    reputationBadge: boolean;
    featured: boolean;
    perContractVnd: number | null;
  };
};

const PLATFORM_LIMITS = {
  maxActiveSla: null,
  maxSourcesPerContract: null,
  probeIntervalSeconds: 60,
  reputationBadge: true,
  featured: false,
  perContractVnd: null,
};
// Chưa có gói / hết hạn: hợp đồng cũ vẫn được giám sát ở chu kỳ chậm nhất, không dùng tính năng mới
const NO_PLAN_LIMITS = {
  maxActiveSla: 0,
  maxSourcesPerContract: 0,
  probeIntervalSeconds: 15 * 60,
  reputationBadge: false,
  featured: false,
  perContractVnd: null,
};

@Injectable()
export class PlanService {
  private readonly logger = new Logger(PlanService.name);

  constructor(private prisma: PrismaService) {}

  private limitsOf(p: PlanDef) {
    return {
      maxActiveSla: p.maxActiveSla,
      maxSourcesPerContract: p.maxSourcesPerContract,
      probeIntervalSeconds: p.probeIntervalSeconds,
      reputationBadge: p.reputationBadge,
      featured: p.featured,
      perContractVnd: p.perContractVnd,
    };
  }

  async isPlatformOrg(orgId: string) {
    const emails = adminEmails();
    if (!emails.length) return false;
    const n = await this.prisma.user.count({ where: { organizationId: orgId, email: { in: emails, mode: 'insensitive' } } });
    return n > 0;
  }

  async getState(orgId: string): Promise<PlanState> {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new BadRequestException('Không tìm thấy doanh nghiệp');
    const pilotUsed = !!org.pilotUsedAt;

    if (await this.isPlatformOrg(orgId)) {
      return { code: 'PLATFORM', name: 'Nội bộ Shadow Byte', active: true, status: 'PLATFORM', startedAt: null, expiresAt: null, pilotUsed, limits: PLATFORM_LIMITS };
    }
    const def = org.planCode ? PLANS[org.planCode as PlanCode] : null;
    if (!def) {
      return { code: null, name: 'Chưa đăng ký gói', active: false, status: 'NONE', startedAt: null, expiresAt: null, pilotUsed, limits: NO_PLAN_LIMITS };
    }
    const expired = !!org.planExpiresAt && org.planExpiresAt.getTime() <= Date.now();
    return {
      code: def.code,
      name: def.name,
      active: !expired,
      status: expired ? 'EXPIRED' : 'ACTIVE',
      startedAt: org.planStartedAt,
      expiresAt: org.planExpiresAt,
      pilotUsed,
      limits: expired ? NO_PLAN_LIMITS : this.limitsOf(def),
    };
  }

  // Chặn tính năng khi doanh nghiệp chưa có gói còn hiệu lực
  async requireActive(orgId: string): Promise<PlanState> {
    const s = await this.getState(orgId);
    if (!s.active) {
      throw new ForbiddenException(
        s.status === 'EXPIRED'
          ? `Gói ${s.name} của doanh nghiệp đã hết hạn. Vào mục "Gói dịch vụ" để gia hạn hoặc chọn gói khác.`
          : 'Doanh nghiệp chưa đăng ký gói dịch vụ nên chỉ xem được giao diện. Vào mục "Gói dịch vụ" để đăng ký (có gói Pilot miễn phí).',
      );
    }
    return s;
  }

  countLiveSla(orgId: string, excludeContractId?: string) {
    return this.prisma.slaContract.count({
      where: {
        status: { in: LIVE_STATUSES },
        ...(excludeContractId ? { id: { not: excludeContractId } } : {}),
        OR: [{ clientId: orgId }, { provider: { organizationId: orgId } }],
      },
    });
  }

  // Kiểm tra còn suất SLA. extra = số hợp đồng sắp thêm (tạo mới: 1; ký hợp đồng đang chờ: 0 vì đã tính)
  async assertSlaQuota(orgId: string, state: PlanState, extra = 1, label = 'Doanh nghiệp của bạn') {
    const max = state.limits.maxActiveSla;
    if (max === null) return;
    const live = await this.countLiveSla(orgId);
    if (live + extra > max) {
      throw new ForbiddenException(
        `${label} đã đạt giới hạn ${max} SLA cùng lúc của gói ${state.name}. Nâng cấp gói để quản lý thêm hợp đồng.`,
      );
    }
  }

  // Chu kỳ đo của hợp đồng = chu kỳ nhanh nhất trong gói của 2 bên
  async probeIntervalFor(orgIds: (string | null | undefined)[]) {
    if (PROBE_OVERRIDE_SECONDS) return PROBE_OVERRIDE_SECONDS;
    let best = NO_PLAN_LIMITS.probeIntervalSeconds;
    for (const id of orgIds) {
      if (!id) continue;
      try {
        best = Math.min(best, (await this.getState(id)).limits.probeIntervalSeconds);
      } catch {
        /* doanh nghiệp giữ chỗ / không tồn tại */
      }
    }
    return best;
  }

  // Số nguồn Oracle tối đa của hợp đồng = theo gói của người đang cấu hình
  async assertSourceQuota(orgId: string, currentSources: number) {
    const s = await this.requireActive(orgId);
    const max = s.limits.maxSourcesPerContract;
    if (max !== null && currentSources + 1 > max) {
      throw new ForbiddenException(`Gói ${s.name} cho phép tối đa ${max} nguồn dữ liệu mỗi hợp đồng. Nâng cấp gói để thêm nguồn.`);
    }
  }

  // ĐĂNG KÝ GÓI (DEMO, CÓ IDEMPOTENCY)
  // Cùng 1 idempotencyKey gửi nhiều lần (bấm 2 lần, mạng gửi lại) -> trả lại đúng kết quả cũ, không tạo giao dịch mới
  async subscribe(orgId: string, userId: string | null, planCode: string, idempotencyKey: string) {
    const key = String(idempotencyKey ?? '').trim();
    if (!/^[A-Za-z0-9_:-]{8,100}$/.test(key)) throw new BadRequestException('Thiếu hoặc sai mã idempotency');

    const existing = await this.prisma.paymentTransaction.findUnique({ where: { idempotencyKey: key } });
    if (existing) {
      if (existing.organizationId !== orgId) throw new BadRequestException('Mã idempotency đã được dùng');
      return { replayed: true, transaction: existing, plan: await this.getState(orgId) };
    }

    const def = PLANS[planCode as PlanCode];
    if (!def) throw new BadRequestException('Gói dịch vụ không hợp lệ');
    if (await this.isPlatformOrg(orgId)) throw new BadRequestException('Doanh nghiệp nội bộ Shadow Byte không cần đăng ký gói');

    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new BadRequestException('Không tìm thấy doanh nghiệp');
    if (def.oneTime && org.pilotUsedAt) throw new BadRequestException('Doanh nghiệp đã dùng gói Pilot. Vui lòng chọn gói khác.');

    // Hạ gói: không cho xuống gói có hạn mức SLA nhỏ hơn số hợp đồng đang chạy
    if (def.maxActiveSla !== null) {
      const live = await this.countLiveSla(orgId);
      if (live > def.maxActiveSla) {
        throw new BadRequestException(`Doanh nghiệp đang có ${live} SLA, vượt hạn mức ${def.maxActiveSla} của gói ${def.name}.`);
      }
    }

    const now = new Date();
    // Gia hạn cùng gói khi còn hiệu lực -> cộng nối tiếp; đổi gói -> tính lại từ hôm nay
    const sameActive = org.planCode === def.code && org.planExpiresAt && org.planExpiresAt > now;
    const base = sameActive ? org.planExpiresAt! : now;
    const expiresAt = def.durationDays ? new Date(base.getTime() + def.durationDays * 86_400_000) : null;

    try {
      const [tx] = await this.prisma.$transaction([
        this.prisma.paymentTransaction.create({
          data: {
            organizationId: orgId,
            userId,
            kind: 'SUBSCRIPTION',
            planCode: def.code,
            amountVnd: def.amountVnd,
            status: 'PAID',
            idempotencyKey: key,
            description: `Đăng ký gói ${def.name}${def.durationDays ? ` (${def.durationDays} ngày)` : ''} - demo, không thu tiền thật`,
          },
        }),
        this.prisma.organization.update({
          where: { id: orgId },
          data: {
            planCode: def.code,
            planStartedAt: sameActive ? org.planStartedAt : now,
            planExpiresAt: expiresAt,
            ...(def.oneTime ? { pilotUsedAt: now } : {}),
          },
        }),
      ]);
      this.logger.log(`${org.name}: đăng ký gói ${def.name}`);
      return { replayed: false, transaction: tx, plan: await this.getState(orgId) };
    } catch (err: any) {
      // 2 yêu cầu trùng key chạy song song: yêu cầu thua bị lỗi unique -> trả kết quả của yêu cầu thắng
      if (err?.code === 'P2002') {
        const tx = await this.prisma.paymentTransaction.findUnique({ where: { idempotencyKey: key } });
        if (tx) return { replayed: true, transaction: tx, plan: await this.getState(orgId) };
      }
      throw err;
    }
  }

  // Pay as you go: ghi phí cho 1 hợp đồng tạo mới. Key cố định theo hợp đồng -> không bao giờ tính 2 lần.
  async chargePerContract(orgId: string, userId: string | null, contractId: string, contractCode: string, state: PlanState) {
    if (!state.limits.perContractVnd) return null;
    const key = `payg:${contractId}`;
    const found = await this.prisma.paymentTransaction.findUnique({ where: { idempotencyKey: key } });
    if (found) return found;
    try {
      return await this.prisma.paymentTransaction.create({
        data: {
          organizationId: orgId,
          userId,
          kind: 'PER_CONTRACT',
          planCode: 'PAYG',
          amountVnd: state.limits.perContractVnd,
          status: 'PAID',
          idempotencyKey: key,
          contractId,
          description: `Phí khởi tạo hợp đồng ${contractCode} (Pay as you go) - demo, không thu tiền thật`,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') return this.prisma.paymentTransaction.findUnique({ where: { idempotencyKey: key } });
      throw err;
    }
  }

  history(orgId: string) {
    return this.prisma.paymentTransaction.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 50 });
  }
}
