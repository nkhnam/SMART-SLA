import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PlanService } from '../billing/plan.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthUser } from '../auth/auth.guard';

// VERIFIED PERFORMANCE PROFILE
// Điểm uy tín tính 100% từ dữ liệu đã được Oracle đo + vụ vi phạm đã ghi on-chain.
// Không có dữ liệu -> KHÔNG chấm điểm (hiện "Đang thu thập dữ liệu"), không bịa số.
const PERFORMANCE_DAYS = 30; // Kỳ đo hiệu suất
const VIOLATION_DAYS = 90; // Kỳ xét lịch sử vi phạm
const MIN_PROBES = 100; // Tối thiểu ~50 phút giám sát liên tục mới chấm điểm

// Trọng số (công khai, giải thích được với khách hàng)
const W_RELIABILITY = 0.5; // Độ ổn định (uptime)
const W_COMPLIANCE = 0.35; // Tuân thủ SLA (lịch sử vi phạm)
const W_RESPONSIVENESS = 0.15; // Tốc độ phản hồi so với cam kết

const clamp = (x: number) => Math.max(0, Math.min(100, x));
const round1 = (x: number) => Math.round(x * 10) / 10;

@Injectable()
export class MarketplaceService {
  constructor(
    private prisma: PrismaService,
    private plans: PlanService,
  ) {}

  // Quyền lợi Marketplace theo gói: huy hiệu uy tín (Starter, Enterprise), ưu tiên top list (Enterprise)
  private async perks(orgId?: string | null) {
    if (!orgId) return { planName: null as string | null, badge: false, featured: false };
    try {
      const s = await this.plans.getState(orgId);
      return { planName: s.active ? s.name : null, badge: s.active && s.limits.reputationBadge, featured: s.active && s.limits.featured };
    } catch {
      return { planName: null, badge: false, featured: false };
    }
  }

  // Huy hiệu "Verified Performance" chỉ hiện khi gói có quyền huy hiệu
  private async profileWithPerks(p: any) {
    const profile: any = await this.computeProfile(p);
    const perks = await this.perks(p.organization?.id);
    return { profile: { ...profile, performanceVerified: profile.performanceVerified && perks.badge }, perks };
  }

  // Tính hồ sơ hiệu suất cho 1 nhà cung cấp
  private async computeProfile(provider: {
    id: string;
    contracts: { id: string; status: string; txHash: string | null; responseMaxMs: number }[];
  }) {
    const ids = provider.contracts.map((c) => c.id);
    const perfSince = new Date(Date.now() - PERFORMANCE_DAYS * 86_400_000);
    const violSince = new Date(Date.now() - VIOLATION_DAYS * 86_400_000);

    const [probes, upProbes, violations] = ids.length
      ? await Promise.all([
          this.prisma.slaEventLog.count({ where: { contractId: { in: ids }, kpiCode: 'HTTP_PROBE', timestamp: { gte: perfSince } } }),
          this.prisma.slaEventLog.count({ where: { contractId: { in: ids }, kpiCode: 'HTTP_PROBE', timestamp: { gte: perfSince }, isUp: true } }),
          this.prisma.violationCase.findMany({
            where: { contractId: { in: ids }, createdAt: { gte: violSince } },
            select: { status: true, creditBps: true },
          }),
        ])
      : [0, 0, [] as { status: string; creditBps: number }[]];

    // Tốc độ phản hồi: so thời gian phản hồi TB của từng hợp đồng với cam kết của chính hợp đồng đó
    const ratios: number[] = [];
    let latencySum = 0;
    let latencyCount = 0;
    for (const c of provider.contracts) {
      const agg = await this.prisma.slaEventLog.aggregate({
        where: { contractId: c.id, kpiCode: 'HTTP_PROBE', timestamp: { gte: perfSince }, isUp: true },
        _avg: { latencyMs: true },
        _count: { latencyMs: true },
      });
      const avg = agg._avg.latencyMs;
      if (avg !== null && agg._count.latencyMs > 0) {
        latencySum += avg * agg._count.latencyMs;
        latencyCount += agg._count.latencyMs;
        if (c.responseMaxMs > 0 && c.responseMaxMs < 100000) ratios.push(avg / c.responseMaxMs);
      }
    }

    // UPHELD = admin giữ nguyên vi phạm sau phản đối -> tính như đã chốt; DISMISSED = huỷ -> không trừ điểm
    const settled = violations.filter((v) => ['SETTLED', 'UPHELD'].includes(v.status)).length;
    const challenged = violations.filter((v) => v.status === 'CHALLENGED').length;
    const pending = violations.filter((v) => v.status === 'PENDING').length;
    const dismissed = violations.filter((v) => v.status === 'DISMISSED').length;

    const uptime = probes ? (upProbes / probes) * 100 : null;
    const avgLatencyMs = latencyCount ? Math.round(latencySum / latencyCount) : null;
    const hasEnoughData = probes >= MIN_PROBES;

    // 3 thành phần điểm (0-100)
    //  - Độ ổn định: uptime 99% -> 0 điểm, 100% -> 100 điểm
    //  - Tuân thủ: mỗi vi phạm đã chốt -15, mỗi vi phạm đang tranh chấp -5
    //  - Phản hồi: TB <= 50% ngưỡng cam kết -> 100 điểm, >= 150% -> 0 điểm
    const reliability = uptime === null ? null : clamp((uptime - 99) * 100);
    const compliance = clamp(100 - 15 * settled - 5 * challenged);
    const avgRatio = ratios.length ? ratios.reduce((a, b) => a + b, 0) / ratios.length : null;
    const responsiveness = avgRatio === null ? null : clamp(((1.5 - avgRatio) / 1) * 100);

    let score: number | null = null;
    if (hasEnoughData && reliability !== null) {
      const resp = responsiveness ?? 100; // không có dữ liệu phản hồi -> không trừ điểm
      score = round1(W_RELIABILITY * reliability + W_COMPLIANCE * compliance + W_RESPONSIVENESS * resp);
    }

    const onChainContracts = provider.contracts.filter((c) => c.txHash).length;

    return {
      score,
      // Huy hiệu "Verified Performance": có điểm + có hợp đồng đã ghi hash trên Polygon
      performanceVerified: score !== null && onChainContracts > 0,
      status: score === null ? 'Đang thu thập dữ liệu' : 'Đã xác minh bằng dữ liệu vận hành',
      metrics: {
        periodDays: PERFORMANCE_DAYS,
        uptime: uptime === null ? null : Number(uptime.toFixed(3)),
        avgLatencyMs,
        probes,
        minProbesRequired: MIN_PROBES,
      },
      components: {
        reliability: reliability === null ? null : round1(reliability),
        compliance: round1(compliance),
        responsiveness: responsiveness === null ? null : round1(responsiveness),
        weights: { reliability: W_RELIABILITY, compliance: W_COMPLIANCE, responsiveness: W_RESPONSIVENESS },
      },
      violations: { periodDays: VIOLATION_DAYS, settled, challenged, pending, dismissed },
      contracts: {
        total: provider.contracts.length,
        active: provider.contracts.filter((c) => ['ACTIVE', 'WARNING'].includes(c.status)).length,
        onChain: onChainContracts,
      },
    };
  }

  private providerQuery = {
    contracts: { select: { id: true, status: true, txHash: true, responseMaxMs: true } },
    organization: { select: { id: true } },
  };

  // Danh sách nhà cung cấp: tìm theo tên, lọc theo loại dịch vụ, xếp theo điểm uy tín
  async list(q?: string, serviceType?: string) {
    const providers = await this.prisma.provider.findMany({
      where: {
        ...(q ? { name: { contains: q, mode: 'insensitive' as const } } : {}),
        ...(serviceType ? { serviceType: { contains: serviceType, mode: 'insensitive' as const } } : {}),
      },
      include: this.providerQuery,
    });

    const rows = await Promise.all(
      providers.map(async (p) => ({
        id: p.id,
        name: p.name,
        serviceType: p.serviceType,
        description: p.description,
        website: p.website,
        hasAccount: !!p.organization, // nhà cung cấp đã có tài khoản trên SLA-DEX
        ...(await this.profileWithPerks(p)),
      })),
    );

    // Gói Enterprise ưu tiên top list; sau đó có điểm xếp trước (cao -> thấp), chưa có điểm xếp sau
    return rows.sort(
      (a, b) => Number(b.perks.featured) - Number(a.perks.featured) || (b.profile.score ?? -1) - (a.profile.score ?? -1),
    );
  }

  // Hồ sơ chi tiết: chỉ công bố số liệu TỔNG HỢP + vi phạm ẩn danh (không lộ bên mua, không lộ nội dung hợp đồng)
  async detail(id: string) {
    const p = await this.prisma.provider.findUnique({ where: { id }, include: this.providerQuery });
    if (!p) throw new NotFoundException('Không tìm thấy nhà cung cấp');

    const recentViolations = await this.prisma.violationCase.findMany({
      where: { contractId: { in: p.contracts.map((c) => c.id) } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        kpiCode: true,
        targetValue: true,
        actualValue: true,
        creditBps: true,
        status: true,
        createdAt: true,
        recordTxHash: true, // giao dịch on-chain vốn công khai -> ai cũng tự kiểm chứng được
        settleTxHash: true,
        challengeTxHash: true,
      },
    });

    return {
      id: p.id,
      name: p.name,
      serviceType: p.serviceType,
      description: p.description,
      website: p.website,
      hasAccount: !!p.organization,
      ...(await this.profileWithPerks(p)),
      recentViolations,
    };
  }

  // Nhà cung cấp tự cập nhật hồ sơ giới thiệu (không tự sửa được điểm uy tín)
  async updateMyProfile(user: AuthUser, body: any) {
    const provider = await this.prisma.provider.findUnique({ where: { organizationId: user.orgId } });
    if (!provider) throw new ForbiddenException('Chỉ tài khoản nhà cung cấp (SUPPLIER) mới có hồ sơ Marketplace');

    const data: { serviceType?: string; description?: string | null; website?: string | null } = {};
    if (body?.serviceType !== undefined) {
      const s = String(body.serviceType).trim();
      if (!s || s.length > 80) throw new BadRequestException('Loại dịch vụ từ 1 đến 80 ký tự');
      data.serviceType = s;
    }
    if (body?.description !== undefined) {
      data.description = String(body.description).trim().slice(0, 1000) || null;
    }
    if (body?.website !== undefined) {
      const w = String(body.website).trim();
      if (w && !/^https?:\/\/\S+$/i.test(w)) throw new BadRequestException('Website phải bắt đầu bằng http:// hoặc https://');
      data.website = w || null;
    }

    await this.prisma.provider.update({ where: { id: provider.id }, data });
    return this.detail(provider.id);
  }
}
