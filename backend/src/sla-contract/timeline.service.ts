import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../billing/plan.service';
import { effectiveEndMs } from './contract-terms';
import { HOOK_EVENT_CODES, hookPartyOf, primaryHook } from './source-priority';

// DỮ LIỆU GANTT CHO DASHBOARD
//   Mỗi hợp đồng 1 dòng: thời hạn hiệu lực, mốc ký, khoảng sự cố (downtime), vụ vi phạm + thời hạn phản đối.
//   range: 1h | 24h | all (toàn thời hạn các hợp đồng)
const RANGES: Record<string, number> = { '1h': 3_600_000, '24h': 86_400_000 };
const MAX_CONTRACTS = 30;
const MAX_DOWN_PROBES = 5000;

export type Incident = { from: string; to: string | null; source: 'HTTP' | 'WEBHOOK' };

@Injectable()
export class TimelineService {
  constructor(
    private prisma: PrismaService,
    private plans: PlanService,
  ) {}

  async timeline(scopeWhere: any, rangeKey: string) {
    const now = Date.now();
    const contracts = await this.prisma.slaContract.findMany({
      where: scopeWhere,
      orderBy: { createdAt: 'desc' },
      take: MAX_CONTRACTS,
      include: {
        client: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true, organizationId: true } },
        signatures: { select: { party: true, signedAt: true } },
        oracleConfigs: { where: { isActive: true }, select: { sourceType: true, endpointUrl: true, createdAt: true } },
      },
    });

    // Cửa sổ thời gian của biểu đồ
    let from: number;
    let to: number;
    if (rangeKey in RANGES) {
      from = now - RANGES[rangeKey];
      to = now;
    } else {
      rangeKey = 'all';
      const starts = contracts.map((c) => (c.effectiveFrom ?? c.createdAt).getTime());
      const ends = contracts.map((c) => effectiveEndMs(c.effectiveTo) ?? now);
      from = starts.length ? Math.min(...starts) : now - 30 * 86_400_000;
      to = Math.max(now, ...(ends.length ? ends : [now]));
    }

    const rows: any[] = [];
    for (const c of contracts) {
      const intervalMs = (await this.plans.probeIntervalFor([c.clientId, c.provider?.organizationId])) * 1000;
      const incidents = [
        ...(await this.httpIncidents(c.id, from, to, intervalMs)),
        // Webhook: chỉ vẽ nguồn đang dùng tính KPI (client trước, provider sau)
        ...(await this.webhookIncidentsOfPrimary(c.id, c.oracleConfigs, from, to)),
      ].sort((a, b) => a.from.localeCompare(b.from));
      const violations = await this.prisma.violationCase.findMany({
        where: {
          contractId: c.id,
          OR: [{ createdAt: { gte: new Date(from), lte: new Date(to) } }, { challengeDeadline: { gte: new Date(from) }, createdAt: { lte: new Date(to) } }],
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, kpiCode: true, createdAt: true, challengeDeadline: true, status: true, creditBps: true, updatedAt: true },
      });
      rows.push({
        id: c.id,
        contractCode: c.contractCode,
        contractName: c.contractName,
        serviceName: c.serviceName,
        status: c.status,
        clientName: c.client.name,
        providerName: c.provider.name,
        createdAt: c.createdAt,
        effectiveFrom: c.effectiveFrom,
        // Hết hạn: tính trọn ngày cuối
        effectiveEnd: effectiveEndMs(c.effectiveTo) ? new Date(effectiveEndMs(c.effectiveTo)!) : null,
        signatures: c.signatures.filter((s) => s.signedAt).map((s) => ({ party: s.party, signedAt: s.signedAt })),
        monitoring: c.oracleConfigs.length > 0,
        incidents,
        violations: violations.map((v) => ({
          id: v.id,
          kpiCode: v.kpiCode,
          detectedAt: v.createdAt,
          challengeDeadline: v.challengeDeadline,
          // Thời điểm chốt / huỷ (để vẽ đoạn kết thúc), còn chờ thì null
          closedAt: ['SETTLED', 'UPHELD', 'DISMISSED'].includes(v.status) ? v.updatedAt : null,
          status: v.status,
          creditBps: v.creditBps,
        })),
      });
    }
    return { range: rangeKey, from: new Date(from).toISOString(), to: new Date(to).toISOString(), now: new Date(now).toISOString(), rows };
  }

  // Sự cố từ HTTP Health Check: gom các lần đo DOWN liền nhau (cách nhau không quá ~3 chu kỳ đo) thành 1 khoảng
  async httpIncidents(contractId: string, from: number, to: number, intervalMs: number): Promise<Incident[]> {
    const downs = await this.prisma.slaEventLog.findMany({
      where: { contractId, kpiCode: 'HTTP_PROBE', isUp: false, timestamp: { gte: new Date(from - intervalMs), lte: new Date(to) } },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true },
      take: MAX_DOWN_PROBES,
    });
    if (!downs.length) return [];
    const gap = Math.max(3 * intervalMs, 90_000);
    const out: { from: number; to: number }[] = [];
    for (const d of downs) {
      const t = d.timestamp.getTime();
      const last = out[out.length - 1];
      if (last && t - last.to <= gap) last.to = t;
      else out.push({ from: t, to: t });
    }
    // Lần đo gần nhất còn DOWN -> sự cố đang diễn ra
    const latest = await this.prisma.slaEventLog.findFirst({
      where: { contractId, kpiCode: 'HTTP_PROBE' },
      orderBy: { timestamp: 'desc' },
      select: { isUp: true },
    });
    return out.map((r, i) => {
      const ongoing = i === out.length - 1 && latest?.isUp === false;
      // Kết thúc sự cố ~ lần đo DOWN cuối + 1 chu kỳ đo
      return { from: new Date(r.from).toISOString(), to: ongoing ? null : new Date(r.to + intervalMs).toISOString(), source: 'HTTP' as const };
    });
  }

  private webhookIncidentsOfPrimary(contractId: string, cfgs: { sourceType: string; endpointUrl: string | null }[], from: number, to: number) {
    const hook = primaryHook(cfgs);
    return hook ? this.webhookIncidents(contractId, from, to, HOOK_EVENT_CODES[hookPartyOf(hook)]) : Promise.resolve([] as Incident[]);
  }

  // Sự cố từ webhook: các cặp sự kiện DOWN -> UP
  async webhookIncidents(contractId: string, from: number, to: number, codes: string[]): Promise<Incident[]> {
    const before = await this.prisma.slaEventLog.findFirst({
      where: { contractId, kpiCode: { in: codes }, timestamp: { lt: new Date(from) } },
      orderBy: { timestamp: 'desc' },
      select: { isUp: true, timestamp: true },
    });
    const events = await this.prisma.slaEventLog.findMany({
      where: { contractId, kpiCode: { in: codes }, timestamp: { gte: new Date(from), lte: new Date(to) } },
      orderBy: { timestamp: 'asc' },
      select: { isUp: true, timestamp: true },
    });
    const out: Incident[] = [];
    let openAt: number | null = before && before.isUp === false ? from : null;
    for (const e of events) {
      const t = e.timestamp.getTime();
      if (e.isUp === false && openAt === null) openAt = t;
      else if (e.isUp !== false && openAt !== null) {
        out.push({ from: new Date(openAt).toISOString(), to: new Date(t).toISOString(), source: 'WEBHOOK' });
        openAt = null;
      }
    }
    if (openAt !== null) out.push({ from: new Date(openAt).toISOString(), to: null, source: 'WEBHOOK' });
    return out;
  }
}
