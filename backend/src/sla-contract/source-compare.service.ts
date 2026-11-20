import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanService } from '../billing/plan.service';
import { Exclusion, TICKET_KPIS } from './kpi-catalog';
import { isExcluded } from './kpi-math';
import { OracleService } from './oracle.service';
import { Incident, TimelineService } from './timeline.service';
import {
  HOOK_EVENT_CODES,
  HookParty,
  LATENCY_CODES,
  SourceKey,
  hookOf,
  hookPartyOf,
  hookSource,
  primaryHook,
  ticketRawId,
  ticketWhere,
} from './source-priority';

// ĐỐI CHIẾU NGUỒN DỮ LIỆU KPI (trang Admin)
//   Mỗi hợp đồng, mỗi KPI đo được: giá trị theo từng nguồn trên cùng 1 khoảng thời gian
//     - Nguồn gốc SMART-SLA (BASE): HTTP với Uptime / thời gian phản hồi, chat hỗ trợ với KPI ticket
//     - Webhook client, webhook provider
//   kèm dữ liệu để vẽ (khoảng sự cố, chuỗi thời gian phản hồi, từng ticket).
//   Lệch quá ngưỡng, hoặc 1 nguồn ghi nhận điều nguồn kia không thấy -> gắn cờ để admin xem xét.
const DEMO_WINDOW_MINUTES = Number(process.env.ORACLE_DEMO_WINDOW_MINUTES) || 0;
const DEFAULT_MINUTES = DEMO_WINDOW_MINUTES || 24 * 60;
const MAX_CONTRACTS = 30;
const MAX_POINTS = 240;
const COMPARED_KPIS = ['UPTIME', 'RESPONSE_TIME', ...TICKET_KPIS];

// Ngưỡng lệch
const UPTIME_DIFF = 0.5; // điểm %
const LATENCY_DIFF_MS = 100; // hoặc 20% so với HTTP, lấy số lớn hơn
const LATENCY_DIFF_RATIO = 0.2;
const TICKET_DIFF = 5; // điểm %
const TICKET_TIME_DIFF_MS = 5 * 60_000; // cùng 1 ticket, 2 bên ghi thời điểm lệch quá 5 phút
const MIN_INCIDENT_MS = 60_000; // sự cố ngắn hơn 1 phút không xét (sai số chu kỳ đo)

const SOURCE_NAME: Record<Exclude<SourceKey, 'BASE'>, string> = { WEBHOOK_CLIENT: 'Webhook client', WEBHOOK_PROVIDER: 'Webhook provider' };
const KPI_LABEL: Record<string, string> = {
  UPTIME: 'Uptime',
  RESPONSE_TIME: 'Thời gian phản hồi',
  FIRST_RESPONSE: 'Phản hồi ticket',
  RESOLUTION_TIME: 'Xử lý ticket',
};

type TicketBar = { id: string; from: string; to: string | null; met: boolean | null };
type SourceResult = {
  configured: boolean;
  since: string | null;
  value: number | null;
  samples: number;
  ready: boolean;
  incidents?: Incident[];
  points?: { t: string; v: number }[];
  tickets?: TicketBar[];
};
type KpiCompare = {
  kpiCode: string;
  label: string;
  unit: string;
  target: number;
  baseLabel: string;
  kpiSource: SourceKey | null;
  sources: Record<SourceKey, SourceResult>;
  maxDiff: number | null;
  verdict: 'MATCH' | 'MISMATCH' | 'NO_DATA' | 'SINGLE';
  notes: string[];
};

const EMPTY: SourceResult = { configured: false, since: null, value: null, samples: 0, ready: false };
const ms = (s: string | null, fallback: number) => (s ? new Date(s).getTime() : fallback);
const overlaps = (a: Incident, b: Incident, now: number) => ms(a.from, now) < ms(b.to, now) && ms(b.from, now) < ms(a.to, now);
const hhmm = (t: number) => new Date(t).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
const span = (i: Incident, now: number) => `${hhmm(ms(i.from, now))}–${i.to ? hhmm(ms(i.to, now)) : 'nay'}`;
const thin = <T>(arr: T[]) => (arr.length <= MAX_POINTS ? arr : arr.filter((_, i) => i % Math.ceil(arr.length / MAX_POINTS) === 0));

@Injectable()
export class SourceCompareService {
  constructor(
    private prisma: PrismaService,
    private plans: PlanService,
    private oracle: OracleService,
    private timeline: TimelineService,
  ) {}

  async compare(minutesParam?: string, contractId?: string) {
    const minutes = Math.min(Math.max(Number(minutesParam) || DEFAULT_MINUTES, 5), 30 * 24 * 60);
    const now = Date.now();
    const from = now - minutes * 60_000;

    const contracts = await this.prisma.slaContract.findMany({
      where: {
        ...(contractId ? { id: contractId } : {}),
        status: { not: 'PENDING_SIGNATURE' },
        kpis: { some: { kpiCode: { in: COMPARED_KPIS } } },
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_CONTRACTS,
      include: {
        kpis: { where: { kpiCode: { in: COMPARED_KPIS } } },
        oracleConfigs: { where: { isActive: true } },
        client: { select: { name: true } },
        provider: { select: { name: true, organizationId: true } },
      },
    });

    const rows: any[] = [];
    for (const c of contracts) {
      const intervalMs = (await this.plans.probeIntervalFor([c.clientId, c.provider?.organizationId])) * 1000;
      const https = c.oracleConfigs.filter((o) => o.sourceType === 'HTTP_CHECK');
      const ctx = { id: c.id, cfgs: c.oracleConfigs, https, from, now, intervalMs };
      const kpis: KpiCompare[] = [];
      for (const k of c.kpis) {
        const exclusions = (k.exclusions as unknown as Exclusion[]) ?? [];
        if (k.kpiCode === 'UPTIME') {
          if (https.length || primaryHook(c.oracleConfigs)) kpis.push(await this.uptime(ctx, k.target, exclusions, k.dataSource === 'WEBHOOK'));
        } else if (k.kpiCode === 'RESPONSE_TIME') {
          if (https.length || primaryHook(c.oracleConfigs)) kpis.push(await this.latency(ctx, k.target, exclusions, k.dataSource === 'WEBHOOK'));
        } else {
          kpis.push(await this.tickets(ctx, k.kpiCode, k.target, k.minPercent ?? 95, k.dataSource === 'WEBHOOK'));
        }
      }
      if (!kpis.length) continue;
      rows.push({
        id: c.id,
        contractCode: c.contractCode,
        contractName: c.contractName,
        status: c.status,
        clientName: c.client.name,
        providerName: c.provider.name,
        kpis,
      });
    }

    return { from: new Date(from).toISOString(), to: new Date(now).toISOString(), now: new Date(now).toISOString(), minutes, rows };
  }

  // Uptime: HTTP (SMART-SLA) và webhook từng bên
  private async uptime(ctx: Ctx, target: number, exclusions: Exclusion[], hookAllowed: boolean): Promise<KpiCompare> {
    const { id, cfgs, https, from, now, intervalMs } = ctx;
    const base: SourceResult = https.length
      ? await (async () => {
          const since = Math.max(from, Math.min(...https.map((h) => h.createdAt.getTime())));
          const m = await this.oracle.httpUptime(id, new Date(since), exclusions, new Date(now));
          return {
            configured: true,
            since: new Date(since).toISOString(),
            value: m.actual,
            samples: m.samples,
            ready: m.ready,
            incidents: await this.timeline.httpIncidents(id, from, now, intervalMs),
          };
        })()
      : { ...EMPTY, incidents: [] };
    const hookRes = async (party: HookParty): Promise<SourceResult> => {
      const cfg = hookOf(cfgs, party);
      if (!cfg) return { ...EMPTY, incidents: [] };
      const since = Math.max(from, cfg.createdAt.getTime());
      const codes = HOOK_EVENT_CODES[party];
      const m = await this.oracle.webhookUptime(id, new Date(since), exclusions, new Date(now), codes);
      return {
        configured: true,
        since: new Date(since).toISOString(),
        value: m.actual,
        samples: m.samples,
        ready: m.ready,
        incidents: await this.timeline.webhookIncidents(id, from, now, codes),
      };
    };
    const sources = { BASE: base, WEBHOOK_CLIENT: await hookRes('BUYER'), WEBHOOK_PROVIDER: await hookRes('SUPPLIER') };
    const primary = hookAllowed ? primaryHook(cfgs) : null;

    const notes: string[] = [];
    let maxDiff: number | null = null;
    for (const key of ['WEBHOOK_CLIENT', 'WEBHOOK_PROVIDER'] as const) {
      const hook = sources[key];
      if (!hook.configured || !base.configured) continue;
      if (hook.value !== null && base.value !== null) {
        const d = Math.abs(hook.value - base.value);
        maxDiff = Math.max(maxDiff ?? 0, d);
        if (d > UPTIME_DIFF) notes.push(`${SOURCE_NAME[key]} ${hook.value}% so với HTTP ${base.value}% (lệch ${d.toFixed(2)} điểm)`);
      }
      // Chỉ xét sự cố trong khoảng cả 2 nguồn cùng hoạt động
      const common = Math.max(ms(hook.since, from), ms(base.since, from));
      const long = (i: Incident) => ms(i.to, now) - ms(i.from, now) >= MIN_INCIDENT_MS && ms(i.to, now) > common;
      for (const i of base.incidents!.filter(long)) {
        if (!hook.incidents!.some((h) => overlaps(i, h, now))) notes.push(`${SOURCE_NAME[key]} không báo sự cố ${span(i, now)} mà HTTP ghi nhận`);
      }
      for (const i of hook.incidents!.filter(long)) {
        if (!base.incidents!.some((h) => overlaps(i, h, now))) notes.push(`${SOURCE_NAME[key]} báo sự cố ${span(i, now)} nhưng HTTP vẫn ghi nhận UP`);
      }
    }
    return this.finish('UPTIME', '%', target, 'HTTP (SMART-SLA)', primary ? hookSource(hookPartyOf(primary)) : https.length ? 'BASE' : null, sources, maxDiff, notes);
  }

  // Thời gian phản hồi: HTTP (SMART-SLA) và thời gian phản hồi webhook từng bên gửi sang
  private async latency(ctx: Ctx, target: number, exclusions: Exclusion[], hookAllowed: boolean): Promise<KpiCompare> {
    const { id, cfgs, https, from, now } = ctx;
    const series = async (codes: string[], since: number, upOnly: boolean): Promise<SourceResult> => {
      const m = await this.oracle.latencyFrom(id, codes, new Date(since), exclusions, new Date(now));
      const rows = await this.prisma.slaEventLog.findMany({
        where: { contractId: id, kpiCode: { in: codes }, timestamp: { gte: new Date(since), lte: new Date(now) }, ...(upOnly ? { isUp: true } : {}) },
        orderBy: { timestamp: 'asc' },
        select: { timestamp: true, latencyMs: true },
      });
      const points = rows.filter((r) => r.latencyMs !== null && !isExcluded(r.timestamp.getTime(), exclusions)).map((r) => ({ t: r.timestamp.toISOString(), v: r.latencyMs! }));
      return { configured: true, since: new Date(since).toISOString(), value: m.actual, samples: m.samples, ready: m.ready, points: thin(points) };
    };
    const base = https.length ? await series(['HTTP_PROBE'], Math.max(from, Math.min(...https.map((h) => h.createdAt.getTime()))), true) : { ...EMPTY, points: [] };
    const hookRes = async (party: HookParty) => {
      const cfg = hookOf(cfgs, party);
      return cfg ? series([LATENCY_CODES[party]], Math.max(from, cfg.createdAt.getTime()), false) : { ...EMPTY, points: [] };
    };
    const sources = { BASE: base, WEBHOOK_CLIENT: await hookRes('BUYER'), WEBHOOK_PROVIDER: await hookRes('SUPPLIER') };
    const party = hookAllowed ? await this.oracle.latencySource(id, cfgs, new Date(from), new Date(now)) : null;

    const notes: string[] = [];
    let maxDiff: number | null = null;
    for (const key of ['WEBHOOK_CLIENT', 'WEBHOOK_PROVIDER'] as const) {
      const hook = sources[key];
      if (!hook.configured || !base.configured || hook.value === null || base.value === null) continue;
      const d = Math.abs(hook.value - base.value);
      maxDiff = Math.max(maxDiff ?? 0, d);
      if (d > Math.max(LATENCY_DIFF_MS, base.value * LATENCY_DIFF_RATIO)) notes.push(`${SOURCE_NAME[key]} báo trung bình ${hook.value}ms, HTTP đo ${base.value}ms (lệch ${d}ms)`);
    }
    return this.finish('RESPONSE_TIME', 'ms', target, 'HTTP (SMART-SLA)', party ? hookSource(party) : https.length ? 'BASE' : null, sources, maxDiff, notes);
  }

  // KPI ticket: chat hỗ trợ SMART-SLA và ticket webhook từng bên gửi sang (Jira, Zendesk…)
  private async tickets(ctx: Ctx, kpiCode: string, target: number, minPercent: number, hookAllowed: boolean): Promise<KpiCompare> {
    const { id, cfgs, from, now } = ctx;
    const unitMs = kpiCode === 'FIRST_RESPONSE' ? 60_000 : 3_600_000;
    const limitMs = target * unitMs;
    const doneOf = (t: { firstResponseAt: Date | null; resolvedAt: Date | null }) => (kpiCode === 'FIRST_RESPONSE' ? t.firstResponseAt : t.resolvedAt);

    const load = (src: 'BASE' | HookParty) =>
      this.prisma.ticket.findMany({
        where: { contractId: id, kind: 'SUPPORT', createdAt: { gte: new Date(from), lte: new Date(now) }, ...ticketWhere(src) },
        orderBy: { createdAt: 'asc' },
        select: { id: true, externalId: true, title: true, createdAt: true, firstResponseAt: true, resolvedAt: true },
      });
    const result = async (src: 'BASE' | HookParty, configured: boolean) => {
      if (!configured) return { res: { ...EMPTY, tickets: [] } as SourceResult, list: [] as Awaited<ReturnType<typeof load>> };
      const list = await load(src);
      const m = await this.oracle.ticketMetric(id, kpiCode, target, new Date(from), new Date(now), src);
      const tickets: TicketBar[] = list.map((t) => {
        const done = doneOf(t);
        const elapsed = (done ? done.getTime() : now) - t.createdAt.getTime();
        return {
          id: src === 'BASE' ? t.title : (ticketRawId(t.externalId) ?? t.title),
          from: t.createdAt.toISOString(),
          to: done ? done.toISOString() : null,
          met: done ? elapsed <= limitMs : elapsed > limitMs ? false : null,
        };
      });
      return { res: { configured: true, since: new Date(from).toISOString(), value: m.actual, samples: m.samples, ready: m.ready, tickets } as SourceResult, list };
    };

    const base = await result('BASE', true);
    const client = await result('BUYER', !!hookOf(cfgs, 'BUYER'));
    const provider = await result('SUPPLIER', !!hookOf(cfgs, 'SUPPLIER'));
    const sources = { BASE: base.res, WEBHOOK_CLIENT: client.res, WEBHOOK_PROVIDER: provider.res };
    const src = hookAllowed ? await this.oracle.ticketSource(id, cfgs, new Date(from), new Date(now)) : 'BASE';

    const notes: string[] = [];
    let maxDiff: number | null = null;
    // So tỷ lệ đạt giữa các nguồn có dữ liệu
    const valued = (['BASE', 'WEBHOOK_CLIENT', 'WEBHOOK_PROVIDER'] as SourceKey[]).filter((k) => sources[k].value !== null);
    for (let i = 0; i < valued.length; i++) {
      for (let j = i + 1; j < valued.length; j++) {
        const a = sources[valued[i]].value!;
        const b = sources[valued[j]].value!;
        const d = Math.abs(a - b);
        maxDiff = Math.max(maxDiff ?? 0, d);
        const name = (k: SourceKey) => (k === 'BASE' ? 'Chat SMART-SLA' : SOURCE_NAME[k]);
        if (d > TICKET_DIFF) notes.push(`${name(valued[i])} ${a}% đạt so với ${name(valued[j])} ${b}% (lệch ${d.toFixed(2)} điểm)`);
      }
    }
    // Cùng 1 ticket do cả 2 bên gửi sang: so thời điểm phản hồi / xử lý
    if (client.list.length && provider.list.length) {
      const byId = new Map(provider.list.map((t) => [ticketRawId(t.externalId), t]));
      for (const c of client.list) {
        const rid = ticketRawId(c.externalId);
        const p = byId.get(rid);
        if (!p) {
          notes.push(`Ticket ${rid} có ở webhook client nhưng webhook provider không gửi`);
          continue;
        }
        byId.delete(rid);
        const a = doneOf(c);
        const b = doneOf(p);
        const what = kpiCode === 'FIRST_RESPONSE' ? 'phản hồi' : 'xử lý xong';
        if (!!a !== !!b) notes.push(`Ticket ${rid}: ${a ? 'client' : 'provider'} ghi đã ${what}, bên kia chưa ghi`);
        else if (a && b && Math.abs(a.getTime() - b.getTime()) > TICKET_TIME_DIFF_MS) {
          notes.push(`Ticket ${rid}: client ghi ${what} lúc ${hhmm(a.getTime())}, provider ghi ${hhmm(b.getTime())}`);
        }
      }
      for (const rid of byId.keys()) notes.push(`Ticket ${rid} có ở webhook provider nhưng webhook client không gửi`);
    }
    return this.finish(kpiCode, '%', minPercent, 'Chat SMART-SLA', src === 'BASE' ? 'BASE' : hookSource(src), sources, maxDiff, notes, `${target} ${kpiCode === 'FIRST_RESPONSE' ? 'phút' : 'giờ'}`);
  }

  private finish(
    kpiCode: string,
    unit: string,
    target: number,
    baseLabel: string,
    kpiSource: SourceKey | null,
    sources: Record<SourceKey, SourceResult>,
    maxDiff: number | null,
    notes: string[],
    limit?: string,
  ): KpiCompare {
    const configured = (Object.keys(sources) as SourceKey[]).filter((k) => sources[k].configured);
    const verdict = configured.length < 2 || !sources.BASE.configured ? 'SINGLE' : notes.length ? 'MISMATCH' : maxDiff === null ? 'NO_DATA' : 'MATCH';
    return {
      kpiCode,
      label: `${KPI_LABEL[kpiCode] ?? kpiCode}${limit ? ` ≤ ${limit}` : ''}`,
      unit,
      target,
      baseLabel,
      kpiSource,
      sources,
      maxDiff: maxDiff === null ? null : Number(maxDiff.toFixed(2)),
      verdict,
      notes,
    };
  }
}

type Ctx = {
  id: string;
  cfgs: { sourceType: string; endpointUrl: string | null; createdAt: Date; isActive: boolean }[];
  https: { createdAt: Date }[];
  from: number;
  now: number;
  intervalMs: number;
};

