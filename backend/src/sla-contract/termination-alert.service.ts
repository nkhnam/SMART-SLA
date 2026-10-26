import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { Exclusion } from './kpi-catalog';
import { countedMs, isExcluded } from './kpi-math';
import { HOOK_EVENT_CODES, hookPartyOf, primaryHook } from './source-priority';

// CẢNH BÁO ĐIỀU KHOẢN CHẤM DỨT
// "Bên mua có quyền đơn phương chấm dứt nếu Uptime dưới 95% trong 02 tháng liên tiếp"
// Mỗi ngày: tính Uptime từng tháng (giờ Việt Nam) đã kết thúc. 2 tháng gần nhất đều < ngưỡng -> báo cả hai bên (1 lần / cặp tháng).
// Tháng thiếu dữ liệu đo -> không kết luận (tránh cảnh báo sai).
const THRESHOLD = Number(process.env.TERMINATION_UPTIME_THRESHOLD) || 95;
const CONSECUTIVE = 2;
// Demo: coi 1 "tháng" là N phút để trình diễn (VD 5). Không đặt -> tháng dương lịch thật.
const DEMO_PERIOD_MINUTES = Number(process.env.TERMINATION_DEMO_PERIOD_MINUTES) || 0;
const MIN_HTTP_SAMPLES = Number(process.env.ORACLE_MIN_SAMPLES) || 10;
const VN_OFFSET_MS = 7 * 3_600_000;
const LIVE = ['ACTIVE', 'WARNING', 'VIOLATED'];

type Period = { label: string; from: number; to: number };
type PeriodResult = Period & { uptime: number | null; samples: number };

@Injectable()
export class TerminationAlertService {
  private readonly logger = new Logger(TerminationAlertService.name);
  private busy = false;

  constructor(
    private prisma: PrismaService,
    private notifier: NotificationService,
  ) {}

  // N kỳ đã kết thúc gần nhất (cũ -> mới)
  lastPeriods(now = Date.now(), n = CONSECUTIVE): Period[] {
    if (DEMO_PERIOD_MINUTES) {
      const len = DEMO_PERIOD_MINUTES * 60_000;
      const end = Math.floor(now / len) * len;
      return Array.from({ length: n }, (_, i) => {
        const to = end - (n - 1 - i) * len;
        const from = to - len;
        const t = new Date(from + VN_OFFSET_MS);
        return { label: `kỳ demo ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`, from, to };
      });
    }
    const vn = new Date(now + VN_OFFSET_MS);
    const periods: Period[] = [];
    for (let i = n; i >= 1; i--) {
      const y = vn.getUTCFullYear();
      const m = vn.getUTCMonth() - i; // tháng đã kết thúc
      const from = Date.UTC(y, m, 1) - VN_OFFSET_MS;
      const to = Date.UTC(y, m + 1, 1) - VN_OFFSET_MS;
      const d = new Date(from + VN_OFFSET_MS);
      periods.push({ label: `tháng ${d.getUTCMonth() + 1}/${d.getUTCFullYear()}`, from, to });
    }
    return periods;
  }

  // Demo: kiểm tra mỗi phút. Thật: mỗi ngày lúc 01:00 giờ Việt Nam (18:00 UTC)
  @Cron(DEMO_PERIOD_MINUTES ? CronExpression.EVERY_MINUTE : '0 18 * * *')
  async run() {
    if (this.busy) return;
    this.busy = true;
    try {
      const contracts = await this.prisma.slaContract.findMany({
        where: { status: { in: LIVE }, kpis: { some: { kpiCode: 'UPTIME' } } },
        include: { kpis: { where: { kpiCode: 'UPTIME' } }, oracleConfigs: true, provider: { select: { organizationId: true } } },
      });
      for (const c of contracts) {
        try {
          await this.checkContract(c);
        } catch (err: any) {
          this.logger.error(`Kiểm tra điều khoản chấm dứt ${c.contractCode} lỗi: ${err?.message}`);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  async checkContract(c: any, now = Date.now()) {
    const kpi = c.kpis[0];
    const exclusions = (kpi.exclusions as Exclusion[]) ?? [];
    const periods = this.lastPeriods(now);
    const key = `${periods[0].from}-${periods[periods.length - 1].to}`;
    if ((c.terminationAlert as any)?.key === key) return null; // đã cảnh báo cặp kỳ này

    const results: PeriodResult[] = [];
    for (const p of periods) results.push({ ...p, ...(await this.periodUptime(c, kpi.dataSource, p, exclusions)) });
    // Thiếu dữ liệu ở bất kỳ kỳ nào -> không kết luận
    if (results.some((r) => r.uptime === null || r.uptime >= THRESHOLD)) return null;

    const summary = results.map((r) => `${r.label}: ${r.uptime}%`).join(', ');
    const alert = { key, threshold: THRESHOLD, at: new Date().toISOString(), periods: results.map(({ label, uptime }) => ({ label, uptime })) };
    await this.prisma.slaContract.update({ where: { id: c.id }, data: { terminationAlert: alert } });

    const title = `${c.contractCode}: Uptime dưới ${THRESHOLD}% trong ${CONSECUTIVE} ${DEMO_PERIOD_MINUTES ? 'kỳ' : 'tháng'} liên tiếp`;
    const message =
      `Hợp đồng ${c.contractCode} (${c.serviceName}) có Uptime ${summary}. ` +
      `Theo điều khoản chấm dứt (nếu có trong hợp đồng), Bên mua có quyền đơn phương chấm dứt ngay và được hoàn phần phí chưa sử dụng. ` +
      `Số liệu do SLA-DEX đo tự động, có thể kiểm chứng trên trang hợp đồng.`;
    const orgIds = [c.clientId, c.provider?.organizationId].filter(Boolean) as string[];
    await this.prisma.notification.createMany({
      data: orgIds.map((organizationId) => ({ organizationId, contractId: c.id, type: 'TERMINATION_ELIGIBLE', title, message })),
    });
    this.logger.warn(`⚠️ ${title} (${summary})`);

    // Email (nếu đã cấu hình workflow gửi mail), không chặn luồng chính
    if (this.notifier.canSendDirectEmail) {
      const users = await this.prisma.user.findMany({ where: { organizationId: { in: orgIds }, isActive: true, role: 'ADMIN' }, select: { email: true } });
      for (const u of users) {
        this.notifier.sendDirectEmail(u.email, `[SLA-DEX] ${title}`, message).catch((e) => this.logger.warn(`Gửi email cảnh báo lỗi: ${e?.message}`));
      }
    }
    return alert;
  }

  // Uptime 1 kỳ theo nguồn dữ liệu của KPI (webhook hoặc HTTP), có trừ khung loại trừ
  private async periodUptime(c: any, dataSource: string, p: Period, exclusions: Exclusion[]) {
    // Cùng thứ tự ưu tiên với Oracle: webhook client > webhook provider > HTTP
    const hook: any = primaryHook(c.oracleConfigs);
    const codes = hook ? HOOK_EVENT_CODES[hookPartyOf(hook)] : [];
    if (hook && dataSource === 'WEBHOOK') {
      // Webhook phải được cấu hình từ trước đầu kỳ thì mới đủ dữ liệu cả kỳ
      if (hook.createdAt.getTime() > p.from) return { uptime: null, samples: 0 };
      const before = await this.prisma.slaEventLog.findFirst({
        where: { contractId: c.id, kpiCode: { in: codes }, timestamp: { lt: new Date(p.from) } },
        orderBy: { timestamp: 'desc' },
      });
      const events = await this.prisma.slaEventLog.findMany({
        where: { contractId: c.id, kpiCode: { in: codes }, timestamp: { gte: new Date(p.from), lt: new Date(p.to) } },
        orderBy: { timestamp: 'asc' },
      });
      let isUp = before?.isUp ?? true;
      let cursor = p.from;
      let downMs = 0;
      for (const e of events) {
        const t = e.timestamp.getTime();
        if (!isUp) downMs += countedMs(cursor, t, exclusions);
        cursor = t;
        isUp = e.isUp ?? true;
      }
      if (!isUp) downMs += countedMs(cursor, p.to, exclusions);
      const total = countedMs(p.from, p.to, exclusions);
      return { uptime: total ? Number((((total - downMs) / total) * 100).toFixed(2)) : null, samples: events.length };
    }
    const probes = (
      await this.prisma.slaEventLog.findMany({
        where: { contractId: c.id, kpiCode: 'HTTP_PROBE', timestamp: { gte: new Date(p.from), lt: new Date(p.to) } },
        select: { isUp: true, timestamp: true },
      })
    ).filter((x) => !isExcluded(x.timestamp.getTime(), exclusions));
    if (probes.length < MIN_HTTP_SAMPLES) return { uptime: null, samples: probes.length };
    const up = probes.filter((x) => x.isUp).length;
    return { uptime: Number(((up / probes.length) * 100).toFixed(2)), samples: probes.length };
  }

  // Uptime 3 kỳ gần nhất + cảnh báo đã gửi (hiển thị trên trang hợp đồng)
  async history(contractId: string) {
    const c = await this.prisma.slaContract.findUnique({
      where: { id: contractId },
      include: { kpis: { where: { kpiCode: 'UPTIME' } }, oracleConfigs: true },
    });
    if (!c || !c.kpis.length) return { hasUptime: false, threshold: THRESHOLD, unit: 'tháng', periods: [], alert: null };
    const kpi = c.kpis[0];
    const exclusions = ((kpi.exclusions as unknown) as Exclusion[]) ?? [];
    const periods = this.lastPeriods(Date.now(), 3);
    const results: { label: string; from: string; to: string; uptime: number | null; samples: number; belowThreshold: boolean }[] = [];
    for (const p of periods) {
      const r = await this.periodUptime(c, kpi.dataSource, p, exclusions);
      results.push({ label: p.label, from: new Date(p.from).toISOString(), to: new Date(p.to).toISOString(), ...r, belowThreshold: r.uptime !== null && r.uptime < THRESHOLD });
    }
    return { hasUptime: true, threshold: THRESHOLD, unit: DEMO_PERIOD_MINUTES ? 'kỳ demo' : 'tháng', periods: results, alert: c.terminationAlert ?? null };
  }
}
