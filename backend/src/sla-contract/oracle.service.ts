import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { randomBytes, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ViolationService } from './violation.service';
import { PlanService } from '../billing/plan.service';
import { Exclusion, TICKET_KPIS } from './kpi-catalog';

// KPI ticket: cần tối thiểu bao nhiêu ticket (đã có kết quả) trong kỳ đo mới kết luận
const MIN_TICKETS = Number(process.env.TICKET_MIN_SAMPLES) || 3;
const TICKET_EVENTS = ['TICKET_CREATED', 'TICKET_RESPONDED', 'TICKET_RESOLVED', 'TICKET_REOPENED'];
import { countedMs, isBreached, isExcluded } from './kpi-math';
import { isInEffect } from './contract-terms';
import {
  HOOK_EVENT_CODES,
  HOOK_PARTIES,
  HookParty,
  LATENCY_CODES,
  hookEventCode,
  hookLabel,
  hookOf,
  hookPartyOf,
  primaryHook,
  ticketKey,
  ticketWhere,
  webhooksOf,
} from './source-priority';

// Demo: ép kỳ đo về N phút cho nhanh (VD: 10). Không đặt -> dùng kỳ đo thật của từng KPI (mặc định 30 ngày)
const DEMO_WINDOW_MINUTES = Number(process.env.ORACLE_DEMO_WINDOW_MINUTES) || 0;
// HTTP_CHECK: cần tối thiểu bao nhiêu lần đo mới được kết luận (10 lần x 30s = 5 phút)
const MIN_SAMPLES = Number(process.env.ORACLE_MIN_SAMPLES) || 10;
// Quá thời gian này mà dịch vụ không trả lời -> tính là DOWN
const TIMEOUT_MS = 5000;

type ProbeResult = { isUp: boolean; latencyMs: number; detail: string };

// Giải thích URL hợp lệ, kèm theo mọi thông báo lỗi URL giám sát
const DEMO_URL_EXAMPLE = `${process.env.PUBLIC_API_URL ?? 'https://shadow-byte-ctwf.onrender.com'}/api/demo-provider/health`;
const URL_HINT = `URL hợp lệ là địa chỉ công khai của dịch vụ cần giám sát, bắt đầu bằng https://, mở bằng trình duyệt phải ra trang hoặc dữ liệu bình thường (không lỗi 404/500). VD: https://api.congty.vn/health. Khi demo, dùng: ${DEMO_URL_EXAMPLE}`;
// Tên miền giao diện (lấy từ CORS_ORIGINS, APP_URL) để phát hiện nhập nhầm frontend
const FRONTEND_HOSTS = [...(process.env.CORS_ORIGINS ?? '').split(','), process.env.APP_URL ?? '']
  .map((o) => {
    try {
      return new URL(o.trim()).hostname;
    } catch {
      return '';
    }
  })
  .filter(Boolean);

// Kết quả đo 1 KPI của hợp đồng
export type KpiResult = {
  kpiCode: string;
  name: string;
  unit: string;
  comparator: string;
  target: number;
  actual: number | null;
  ready: boolean; // đủ dữ liệu để kết luận chưa
  breached: boolean;
  samples: number; // HTTP_CHECK: số lần đo | WEBHOOK: số sự kiện
  windowStart: string;
  downtimeSeconds?: number;
  note?: string;
};

@Injectable()
export class OracleService {
  private readonly logger = new Logger(OracleService.name);
  private busy = false; // tránh 2 lượt quét chạy chồng nhau

  constructor(
    private prisma: PrismaService,
    private violationService: ViolationService,
    private plans: PlanService,
  ) {}

  // CONNECTOR 1: HTTP HEALTH CHECK
  // SLA_DEX tự gọi thật vào endpoint của nhà cung cấp, đo sống/chết + thời gian phản hồi
  async probeHttp(url: string): Promise<ProbeResult> {
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { 'User-Agent': 'SLA_DEX-OracleHub/1.0' },
      });
      return { isUp: res.status < 400, latencyMs: Date.now() - started, detail: `HTTP ${res.status}` };
    } catch (err: any) {
      const detail =
        err?.name === 'TimeoutError'
          ? `Timeout > ${TIMEOUT_MS}ms`
          : `Lỗi kết nối: ${err?.cause?.code ?? err?.message}`;
      return { isUp: false, latencyMs: Date.now() - started, detail };
    }
  }

  // CONNECTOR 2: WEBHOOK
  // Hệ thống giám sát sẵn có của doanh nghiệp (Datadog, CloudWatch, UptimeRobot...) tự đẩy sự kiện sang
  async receiveWebhook(contractId: string, token: string | undefined, body: any) {
    // Mỗi bên có địa chỉ webhook riêng: token cho biết sự kiện đến từ webhook của bên nào
    const cfgs = await this.prisma.oracleConfig.findMany({
      where: { contractId, sourceType: 'WEBHOOK', isActive: true, paused: false },
    });
    const cfg = token ? cfgs.find((c) => c.apiKeySecret && this.safeEqual(token, c.apiKeySecret)) : undefined;
    if (!cfg) throw new Error('UNAUTHORIZED');
    const party = hookPartyOf(cfg);

    // Sự kiện TICKET (Jira Automation, Zendesk, Freshdesk... gửi sang)
    const ticketEvent = String(body?.event ?? '').toUpperCase();
    if (TICKET_EVENTS.includes(ticketEvent)) {
      return this.receiveTicketEvent(contractId, ticketEvent, body, party);
    }

    const state = this.normalizeWebhook(body);
    // Thời gian phản hồi (ms) đo từ công cụ của bên gửi: {"responseTimeMs": 230}
    const latencyRaw = Number(body?.responseTimeMs ?? body?.latencyMs ?? body?.responseTime);
    const latency = Number.isFinite(latencyRaw) && latencyRaw >= 0 && latencyRaw < 600_000 ? Math.round(latencyRaw) : null;
    if (!state && latency === null) throw new Error('Không nhận diện được dữ liệu (cần status DOWN/UP hoặc responseTimeMs)');

    const source = String(body?.source ?? body?.monitorFriendlyName ?? 'webhook').slice(0, 60);
    const message = String(body?.message ?? body?.alertDetails ?? body?.title ?? '').slice(0, 200);

    if (latency !== null) {
      await this.prisma.slaEventLog.create({
        data: {
          contractId,
          kpiCode: LATENCY_CODES[party],
          latencyMs: latency,
          metricValue: latency,
          isViolation: false,
          description: `${latency}ms | ${hookLabel(party)} | nguồn: ${source}`,
        },
      });
    }
    if (!state) {
      await this.evaluate(contractId);
      return { received: true, responseTimeMs: latency };
    }

    await this.prisma.slaEventLog.create({
      data: {
        contractId,
        kpiCode: hookEventCode(party),
        isUp: state === 'UP',
        isViolation: false,
        description: `${state} | webhook ${party === 'BUYER' ? 'client' : 'provider'} | nguồn: ${source}${message ? ' | ' + message : ''}`,
      },
    });
    this.logger.log(`Webhook ${party === 'BUYER' ? 'client' : 'provider'} ${state} cho hợp đồng ${contractId} (nguồn: ${source})`);

    // Kết luận ngay khi có sự kiện mới, không chờ lượt quét
    await this.evaluate(contractId);

    return { received: true, state, ...(latency !== null ? { responseTimeMs: latency } : {}) };
  }

  // Chuẩn hoá payload từ nhiều công cụ khác nhau về DOWN / UP
  private normalizeWebhook(body: any): 'DOWN' | 'UP' | null {
    // Định dạng chuẩn của SLA_DEX: { "status": "DOWN" | "UP" }
    const raw = String(body?.status ?? body?.event ?? body?.state ?? '').toUpperCase();
    if (['DOWN', 'TRIGGERED', 'ALERT', 'ALARM', 'FIRING', 'CRITICAL'].includes(raw)) return 'DOWN';
    if (['UP', 'RECOVERED', 'OK', 'RESOLVED'].includes(raw)) return 'UP';
    // UptimeRobot: alertType 1 = down, 2 = up
    const t = String(body?.alertType ?? '');
    if (t === '1') return 'DOWN';
    if (t === '2') return 'UP';
    // Datadog (alert_transition), Grafana (state: alerting/ok), Zabbix (PROBLEM/RESOLVED)
    const more = String(body?.alert_transition ?? body?.transition ?? '').toUpperCase();
    if (['TRIGGERED', 'ALERTING', 'PROBLEM'].includes(more) || ['ALERTING', 'PROBLEM'].includes(raw)) return 'DOWN';
    if (['RECOVERED', 'OK', 'RESOLVED'].includes(more)) return 'UP';
    // AWS CloudWatch qua SNS: NewStateValue ALARM / OK, có thể nằm trong chuỗi JSON "Message"
    let cw = body?.NewStateValue;
    if (!cw && typeof body?.Message === 'string') {
      try {
        cw = JSON.parse(body.Message)?.NewStateValue;
      } catch {
        cw = undefined;
      }
    }
    if (String(cw ?? '').toUpperCase() === 'ALARM') return 'DOWN';
    if (String(cw ?? '').toUpperCase() === 'OK') return 'UP';
    return null;
  }

  private safeEqual(a: string, b: string): boolean {
    const x = Buffer.from(a);
    const y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  }

  // VÒNG QUÉT MỖI 30 GIÂY
  // Mỗi nguồn HTTP được đo theo chu kỳ của GÓI DỊCH VỤ (Pilot 15 phút, PAYG/Starter 5 phút, Enterprise 1 phút)
  @Cron(CronExpression.EVERY_30_SECONDS)
  async handleCron() {
    if (this.busy) return;
    this.busy = true;
    try {
      // Quét cả hợp đồng đang vi phạm: KPI khác vẫn cần theo dõi, và hợp đồng có thể hồi phục
      const contracts = await this.prisma.slaContract.findMany({
        where: { status: { in: ['ACTIVE', 'WARNING', 'VIOLATED'] } },
        include: {
          oracleConfigs: { where: { isActive: true, paused: false } },
          kpis: { select: { kpiCode: true } },
          provider: { select: { organizationId: true } },
        },
      });

      for (const c of contracts) {
        const https = c.oracleConfigs.filter((o) => o.sourceType === 'HTTP_CHECK' && o.endpointUrl);
        const hook = primaryHook(c.oracleConfigs);
        const hasTicketKpi = c.kpis.some((k) => TICKET_KPIS.includes(k.kpiCode));
        // Không có nguồn dữ liệu nào -> không giám sát, KHÔNG bịa số (KPI ticket luôn đo được từ bảng Ticket)
        if (!https.length && !hook && !hasTicketKpi) continue;
        // Ngoài thời hạn hiệu lực (chưa tới ngày hiệu lực / đã hết hạn) -> không đo, không tính phạt
        if (!isInEffect(c)) continue;

        const intervalMs = (await this.plans.probeIntervalFor([c.clientId, c.provider?.organizationId])) * 1000;
        let probed = false;
        for (const http of https) {
          // Chưa tới chu kỳ đo của gói -> bỏ qua (trừ 5 giây sai số của vòng quét)
          if (http.lastProbedAt && Date.now() - http.lastProbedAt.getTime() < intervalMs - 5000) continue;
          await this.probeAndLog(c.id, http.id, http.endpointUrl!);
          probed = true;
        }

        // Kết luận khi có số đo mới, hoặc hợp đồng dùng webhook / ticket (dữ liệu đến bất kỳ lúc nào)
        if (probed || hook || hasTicketKpi) await this.evaluate(c.id);
      }
    } catch (err: any) {
      this.logger.error(`Oracle Hub lỗi: ${err?.message}`);
    } finally {
      this.busy = false;
    }
  }

  // Đo 1 URL và ghi kết quả vào nhật ký
  private async probeAndLog(contractId: string, configId: string, url: string) {
    const probe = await this.probeHttp(url);
    await this.prisma.slaEventLog.create({
      data: {
        contractId,
        kpiCode: 'HTTP_PROBE',
        isUp: probe.isUp,
        latencyMs: probe.latencyMs,
        metricValue: probe.latencyMs,
        isViolation: false,
        description: `${probe.isUp ? 'UP' : 'DOWN'} | ${probe.detail} | ${probe.latencyMs}ms | ${url}`,
      },
    });
    await this.prisma.oracleConfig.update({ where: { id: configId }, data: { lastProbedAt: new Date() } });
    return probe;
  }

  // Đo ngay mọi hợp đồng đang giám sát URL có chứa đoạn path (nút Gây sự cố / Khôi phục của demo), không chờ vòng quét
  async probeNowByPath(path: string) {
    const cfgs = await this.prisma.oracleConfig.findMany({
      where: {
        sourceType: 'HTTP_CHECK',
        isActive: true,
        paused: false,
        endpointUrl: { contains: path },
        contract: { status: { in: ['ACTIVE', 'WARNING', 'VIOLATED'] } },
      },
      include: { contract: { select: { effectiveFrom: true, effectiveTo: true } } },
    });
    const ids = new Set<string>();
    for (const cfg of cfgs) {
      if (!isInEffect(cfg.contract)) continue;
      await this.probeAndLog(cfg.contractId, cfg.id, cfg.endpointUrl!);
      ids.add(cfg.contractId);
    }
    for (const id of ids) await this.evaluate(id);
    return ids.size;
  }

  // Kết quả lần đo gần nhất của 1 URL: UP/DOWN + chi tiết (HTTP 503, Timeout, lỗi kết nối...)
  async lastProbe(contractId: string, url: string) {
    const row = await this.prisma.slaEventLog.findFirst({
      where: { contractId, kpiCode: 'HTTP_PROBE', description: { endsWith: url } },
      orderBy: { timestamp: 'desc' },
      select: { isUp: true, description: true, latencyMs: true, timestamp: true },
    });
    if (!row) return null;
    return { isUp: !!row.isUp, detail: row.description?.split(' | ')[1] ?? '', latencyMs: row.latencyMs, at: row.timestamp };
  }

  // Hợp đồng của tổ chức đang giám sát URL có chứa đoạn path (bảng demo trên Dashboard)
  async watchersByPath(path: string, orgId: string) {
    const cfgs = await this.prisma.oracleConfig.findMany({
      where: {
        sourceType: 'HTTP_CHECK',
        isActive: true,
        endpointUrl: { contains: path },
        contract: { status: { not: 'TERMINATED' }, OR: [{ clientId: orgId }, { provider: { organizationId: orgId } }] },
      },
      include: { contract: { select: { id: true, contractCode: true, contractName: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return Promise.all(
      cfgs.map(async (c) => ({
        contractId: c.contract.id,
        contractCode: c.contract.contractCode,
        contractName: c.contract.contractName,
        status: c.contract.status,
        paused: c.paused,
        last: await this.lastProbe(c.contractId, c.endpointUrl!),
      })),
    );
  }

  // ĐO TỪNG KPI THEO ĐIỀU KHOẢN HỢP ĐỒNG
  // range: đo cho 1 kỳ đối soát cụ thể [from, to). Không truyền -> kỳ đo trượt tính đến hiện tại
  async getKpiSummary(contractId: string, range?: { from: Date; to: Date }) {
    const contract = await this.prisma.slaContract.findUnique({
      where: { id: contractId },
      include: { kpis: true, oracleConfigs: { where: { isActive: true, paused: false } } },
    });
    if (!contract) return { contractId, source: 'NONE', sources: [] as string[], monitoring: false, kpis: [] as KpiResult[] };

    // Có thể có nhiều nguồn cùng lúc (nhiều URL HTTP + 1 webhook). Mỗi KPI đo theo đúng nguồn đã khai báo.
    const httpCfgs = contract.oracleConfigs.filter((o) => o.sourceType === 'HTTP_CHECK');
    // Ưu tiên tính Uptime: webhook client > webhook provider > HTTP (HTTP vẫn đo song song để đối chiếu)
    const hookCfg = primaryHook(contract.oracleConfigs);
    const uptimeHookLabel = hookCfg ? hookLabel(hookPartyOf(hookCfg)) : '';
    const httpSince = httpCfgs.length ? Math.min(...httpCfgs.map((o) => o.createdAt.getTime())) : 0;
    const sources = [...new Set(contract.oracleConfigs.map((o) => o.sourceType))];
    const source = sources[0] ?? 'NONE';

    const kpis: KpiResult[] = [];
    for (const k of contract.kpis) {
      const exclusions = (k.exclusions as unknown as Exclusion[]) ?? [];
      const windowMinutes = DEMO_WINDOW_MINUTES || k.windowMinutes;
      // Nguồn dùng cho KPI này: đúng nguồn đã khai báo, không có thì dùng nguồn còn lại (ghi chú rõ)
      const wantHook = k.dataSource === 'WEBHOOK';
      // Webhook chỉ được dùng tính KPI khi điều khoản cho phép (nguồn WEBHOOK, đã ký và ghi lên chain)
      const useHook = k.kpiCode === 'UPTIME' && wantHook && !!hookCfg;
      const useHttp = !useHook && httpCfgs.length > 0;
      const fallback = wantHook && useHttp;
      const since = useHook ? hookCfg!.createdAt.getTime() : useHttp ? httpSince : 0;
      // Kỳ đo bắt đầu từ: max(hiện tại - kỳ đo, lúc bắt đầu giám sát) -> không tính khoảng thời gian chưa theo dõi
      const windowFrom = range ? range.from.getTime() : Date.now() - windowMinutes * 60_000;
      const end = range ? range.to : undefined;
      const start = new Date(Math.max(windowFrom, since));
      const base = {
        kpiCode: k.kpiCode,
        name: k.name,
        unit: k.unit,
        comparator: k.comparator,
        target: k.target,
        windowStart: start.toISOString(),
      };

      // KPI ticket: % ticket đạt ngưỡng. Nguồn: ticket từ webhook client > webhook provider > chat hỗ trợ SLA-DEX
      if (TICKET_KPIS.includes(k.kpiCode) && k.minPercent !== null) {
        const src = k.dataSource === 'WEBHOOK' ? await this.ticketSource(contract.id, contract.oracleConfigs, new Date(windowFrom), end) : 'BASE';
        const t = await this.ticketMetric(contract.id, k.kpiCode, k.target, new Date(windowFrom), end, src);
        if (src !== 'BASE') t.note = `${t.note}. Tính theo ticket của ${hookLabel(src)}, chat SLA-DEX dùng để đối chiếu`;
        kpis.push({
          kpiCode: k.kpiCode,
          name: `${k.name} ≤ ${k.target} ${k.unit}`,
          unit: '%',
          comparator: 'GTE',
          target: k.minPercent,
          windowStart: new Date(windowFrom).toISOString(),
          actual: t.actual,
          ready: t.ready,
          samples: t.samples,
          note: t.note,
          breached: t.ready && t.actual !== null && t.actual < k.minPercent,
        });
        continue;
      }

      let m: { actual: number | null; ready: boolean; samples: number; downtimeSeconds?: number; note?: string };
      if (k.kpiCode === 'UPTIME' && (useHook || useHttp)) {
        m = useHook
          ? await this.webhookUptime(contract.id, start, exclusions, end, HOOK_EVENT_CODES[hookPartyOf(hookCfg)])
          : await this.httpUptime(contract.id, start, exclusions, end);
        if (useHook) m.note = [m.note, `Tính theo ${uptimeHookLabel}${httpCfgs.length ? ', HTTP đo song song để đối chiếu' : ''}`].filter(Boolean).join('. ');
        else if (fallback) m.note = `Chưa có webhook, đang đo bằng HTTP`;
      } else if (k.kpiCode === 'RESPONSE_TIME') {
        // Ưu tiên webhook có gửi thời gian phản hồi trong kỳ (client > provider), không có thì dùng HTTP
        const party = wantHook ? await this.latencySource(contract.id, contract.oracleConfigs, new Date(windowFrom), end) : null;
        if (party) {
          const hook = hookOf(contract.oracleConfigs, party)!;
          const hStart = new Date(Math.max(windowFrom, hook.createdAt.getTime()));
          m = await this.latencyFrom(contract.id, [LATENCY_CODES[party]], hStart, exclusions, end);
          m.note = `Tính theo ${hookLabel(party)}${httpCfgs.length ? ', HTTP đo song song để đối chiếu' : ''}`;
          base.windowStart = hStart.toISOString();
        } else if (useHttp) {
          m = await this.httpLatency(contract.id, start, exclusions, end);
        } else {
          m = { actual: null, ready: false, samples: 0, note: 'Chưa cấu hình nguồn dữ liệu' };
        }
      } else if (!useHook && !useHttp) {
        m = { actual: null, ready: false, samples: 0, note: 'Chưa cấu hình nguồn dữ liệu' };
      } else {
        m = { actual: null, ready: false, samples: 0, note: `KPI này cần nguồn ${k.dataSource}` };
      }

      kpis.push({
        ...base,
        ...m,
        breached: m.ready && m.actual !== null && isBreached(k.comparator, k.target, m.actual),
      });
    }

    const hasTicketKpi = contract.kpis.some((k) => TICKET_KPIS.includes(k.kpiCode));
    return { contractId, source, sources, monitoring: sources.length > 0 || hasTicketKpi, kpis };
  }

  // Webhook có gửi thời gian phản hồi trong kỳ (client trước, provider sau). Không có -> null (dùng HTTP)
  async latencySource(contractId: string, cfgs: { sourceType: string; endpointUrl: string | null }[], since: Date, until?: Date): Promise<HookParty | null> {
    for (const party of HOOK_PARTIES) {
      if (!hookOf(cfgs, party)) continue;
      const n = await this.prisma.slaEventLog.count({
        where: { contractId, kpiCode: LATENCY_CODES[party], timestamp: { gte: since, ...(until ? { lt: until } : {}) } },
      });
      if (n > 0) return party;
    }
    return null;
  }

  // Nguồn ticket: webhook có gửi ticket trong kỳ (client trước, provider sau). Không có -> chat hỗ trợ SLA-DEX
  async ticketSource(contractId: string, cfgs: { sourceType: string; endpointUrl: string | null }[], since: Date, until?: Date): Promise<'BASE' | HookParty> {
    for (const party of HOOK_PARTIES) {
      if (!hookOf(cfgs, party)) continue;
      const n = await this.prisma.ticket.count({
        where: { contractId, kind: 'SUPPORT', createdAt: { gte: since, ...(until ? { lt: until } : {}) }, ...ticketWhere(party) },
      });
      if (n > 0) return party;
    }
    return 'BASE';
  }

  // % ticket đạt ngưỡng. Ticket chưa có kết quả: chỉ tính (là KHÔNG đạt) khi đã quá ngưỡng, còn lại để "đang chờ"
  async ticketMetric(contractId: string, kpiCode: string, target: number, since: Date, until: Date | undefined, src: 'BASE' | HookParty) {
    const tickets = await this.prisma.ticket.findMany({
      where: { contractId, kind: 'SUPPORT', createdAt: { gte: since, ...(until ? { lt: until } : {}) }, ...ticketWhere(src) },
      select: { createdAt: true, firstResponseAt: true, resolvedAt: true },
    });
    const unitMs = kpiCode === 'FIRST_RESPONSE' ? 60_000 : 3_600_000; // phút | giờ
    const now = until ? Math.min(until.getTime(), Date.now()) : Date.now();
    let met = 0;
    let counted = 0;
    let pending = 0;
    for (const t of tickets) {
      const doneAt = kpiCode === 'FIRST_RESPONSE' ? t.firstResponseAt : t.resolvedAt;
      // Kết quả sau thời điểm chốt kỳ -> coi như chưa có tại lúc chốt
      const end = doneAt && doneAt.getTime() <= now ? doneAt : null;
      const elapsed = ((end ? end.getTime() : now) - t.createdAt.getTime()) / unitMs;
      if (end) {
        counted++;
        if (elapsed <= target) met++;
      } else if (elapsed > target) {
        counted++; // quá hạn mà chưa có kết quả -> chắc chắn không đạt
      } else {
        pending++;
      }
    }
    return {
      actual: counted ? Math.round((met / counted) * 10000) / 100 : null,
      ready: counted >= MIN_TICKETS,
      samples: counted,
      note: `${met}/${counted} ticket đạt, ${pending} đang chờ${counted < MIN_TICKETS ? ` (cần tối thiểu ${MIN_TICKETS} ticket)` : ''}`,
    };
  }

  // Sự kiện ticket từ hệ thống bên ngoài -> lưu CHUNG bảng Ticket với ticket chat của SLA_DEX
  private async receiveTicketEvent(contractId: string, event: string, body: any, party: HookParty) {
    const rawId = String(body?.ticketId ?? '').trim().slice(0, 90);
    if (!rawId) throw new Error('Thiếu ticketId');
    // Mỗi bên lưu bản riêng của ticket (để đối chiếu khi 2 bên cùng gửi 1 ticket)
    const externalId = ticketKey(party, rawId);
    let at = body?.occurredAt ? new Date(body.occurredAt) : new Date();
    if (Number.isNaN(at.getTime())) throw new Error('occurredAt không đúng định dạng thời gian');
    if (at.getTime() > Date.now() + 5 * 60_000) throw new Error('occurredAt không được ở tương lai');

    const existing = await this.prisma.ticket.findUnique({ where: { contractId_externalId: { contractId, externalId } } });

    if (event === 'TICKET_CREATED') {
      if (existing) return { received: true, event, ticketId: rawId, note: 'Ticket đã tồn tại' };
      await this.prisma.ticket.create({
        data: {
          contractId,
          kind: 'SUPPORT',
          source: 'WEBHOOK',
          externalId,
          title: String(body?.title ?? externalId).slice(0, 200),
          status: 'OPEN',
          createdById: 'webhook',
          createdByParty: party,
          createdAt: at,
        },
      });
    } else {
      if (!existing) throw new Error(`Chưa có ticket ${rawId}, cần gửi TICKET_CREATED trước`);
      if (at < existing.createdAt) at = existing.createdAt;
      const data: Record<string, unknown> = {};
      if (event === 'TICKET_RESPONDED' && !existing.firstResponseAt) {
        data.firstResponseAt = at;
        data.status = existing.status === 'OPEN' ? 'IN_PROGRESS' : existing.status;
      }
      if (event === 'TICKET_RESOLVED') {
        data.resolvedAt = at;
        data.status = 'RESOLVED';
        if (!existing.firstResponseAt) data.firstResponseAt = at;
      }
      if (event === 'TICKET_REOPENED') {
        data.resolvedAt = null;
        data.status = 'IN_PROGRESS';
      }
      if (Object.keys(data).length) await this.prisma.ticket.update({ where: { id: existing.id }, data });
    }
    this.logger.log(`Webhook ${event} ticket ${externalId} (hợp đồng ${contractId})`);
    await this.evaluate(contractId);
    return { received: true, event, ticketId: rawId };
  }

  // Uptime từ các lần HTTP probe (bỏ qua lần đo rơi vào khung loại trừ)
  async httpUptime(contractId: string, start: Date, exclusions: Exclusion[], end?: Date): Promise<{ actual: number | null; ready: boolean; samples: number; note?: string }> {
    const probes = (
      await this.prisma.slaEventLog.findMany({
        where: { contractId, kpiCode: 'HTTP_PROBE', timestamp: { gte: start, ...(end ? { lt: end } : {}) } },
        select: { isUp: true, timestamp: true },
      })
    ).filter((p) => !isExcluded(p.timestamp.getTime(), exclusions));
    const samples = probes.length;
    const up = probes.filter((p) => p.isUp).length;
    return {
      actual: samples ? Number(((up / samples) * 100).toFixed(2)) : null,
      ready: samples >= MIN_SAMPLES,
      samples,
    };
  }

  // Thời gian phản hồi trung bình từ các lần HTTP probe thành công
  httpLatency(contractId: string, start: Date, exclusions: Exclusion[], end?: Date) {
    return this.latencyFrom(contractId, ['HTTP_PROBE'], start, exclusions, end);
  }

  // Thời gian phản hồi trung bình theo mã sự kiện (HTTP_PROBE: chỉ lần đo UP; webhook: mọi lần gửi)
  async latencyFrom(contractId: string, codes: string[], start: Date, exclusions: Exclusion[], end?: Date): Promise<{ actual: number | null; ready: boolean; samples: number; note?: string }> {
    const isHttp = codes.includes('HTTP_PROBE');
    const probes = (
      await this.prisma.slaEventLog.findMany({
        where: { contractId, kpiCode: { in: codes }, timestamp: { gte: start, ...(end ? { lt: end } : {}) }, ...(isHttp ? { isUp: true } : {}) },
        select: { latencyMs: true, timestamp: true },
      })
    ).filter((p) => p.latencyMs !== null && !isExcluded(p.timestamp.getTime(), exclusions));
    const samples = probes.length;
    return {
      actual: samples ? Math.round(probes.reduce((a, p) => a + p.latencyMs!, 0) / samples) : null,
      ready: samples >= MIN_SAMPLES,
      samples,
    };
  }

  // Uptime từ chuỗi sự kiện DOWN/UP của webhook: cộng dồn thời gian sập, trừ khung loại trừ
  async webhookUptime(contractId: string, start: Date, exclusions: Exclusion[], end: Date | undefined, codes: string[]): Promise<{ actual: number | null; ready: boolean; samples: number; downtimeSeconds?: number; note?: string }> {
    const now = end ? Math.min(end.getTime(), Date.now()) : Date.now();
    if (now <= start.getTime()) return { actual: null, ready: false, samples: 0, note: 'Chưa giám sát trong kỳ này' };
    const before = await this.prisma.slaEventLog.findFirst({
      where: { contractId, kpiCode: { in: codes }, timestamp: { lt: start } },
      orderBy: { timestamp: 'desc' },
    });
    const events = await this.prisma.slaEventLog.findMany({
      where: { contractId, kpiCode: { in: codes }, timestamp: { gte: start, lt: new Date(now) } },
      orderBy: { timestamp: 'asc' },
    });

    let isUp = before?.isUp ?? true;
    let cursor = start.getTime();
    let downMs = 0;
    for (const e of events) {
      const t = e.timestamp.getTime();
      if (!isUp) downMs += countedMs(cursor, t, exclusions);
      cursor = t;
      isUp = e.isUp ?? true;
    }
    if (!isUp) downMs += countedMs(cursor, now, exclusions);

    const totalMs = countedMs(start.getTime(), now, exclusions);
    if (totalMs < 60_000) return { actual: null, ready: false, samples: events.length, note: 'Mới bắt đầu giám sát' };
    return {
      actual: Number((((totalMs - downMs) / totalMs) * 100).toFixed(2)),
      ready: true,
      samples: events.length,
      downtimeSeconds: Math.round(downMs / 1000),
    };
  }

  private async evaluate(contractId: string) {
    const contract = await this.prisma.slaContract.findUnique({ where: { id: contractId }, include: { kpis: true } });
    // Hợp đồng đã dừng (chạm trần phạt) hoặc ngoài thời hạn -> không đo, không mở vụ mới
    if (!contract || contract.status === 'TERMINATED' || contract.status === 'PENDING_SIGNATURE' || !isInEffect(contract)) return;
    const summary = await this.getKpiSummary(contractId);

    const breached = summary.kpis.filter((k) => k.breached);
    // Cảnh báo sớm: KPI dạng thời gian đã vượt 80% ngưỡng
    const nearLimit = summary.kpis.some(
      (k) => k.ready && k.actual !== null && k.comparator === 'LTE' && !k.breached && k.actual > k.target * 0.8,
    );
    const newStatus = breached.length ? 'VIOLATED' : nearLimit ? 'WARNING' : 'ACTIVE';
    if (newStatus !== contract.status) {
      await this.prisma.slaContract.update({ where: { id: contractId }, data: { status: newStatus } });
    }

    // Đang có khiếu nại chờ admin xử lý -> vẫn đo, nhưng tạm giữ việc mở vụ phạt mới (tự mở lại khi admin xử lý xong)
    if (breached.length && (await this.prisma.violationCase.count({ where: { contractId, status: 'CHALLENGED' } }))) {
      this.logger.warn(`${contract.contractCode}: đang có khiếu nại, tạm giữ mở vụ phạt mới (${breached.map((b) => b.kpiCode).join(', ')})`);
      return;
    }

    for (const r of breached) {
      const kpi = contract.kpis.find((k) => k.kpiCode === r.kpiCode)!;
      try {
        const opened = await this.violationService.openCase(
          contractId,
          { kpiCode: kpi.kpiCode, comparator: r.comparator, target: r.target, windowMinutes: kpi.windowMinutes, creditTiers: kpi.creditTiers },
          r.actual!,
        );
        if (opened?.isNew) {
          const basis =
            r.downtimeSeconds !== undefined ? `sập ${r.downtimeSeconds}s, theo webhook` : `${r.samples} lần đo`;
          const description = `Vi phạm ${r.name}: đo được ${r.actual}${r.unit}, cam kết ${r.comparator === 'GTE' ? '≥' : '≤'} ${r.target}${r.unit} (${basis}, từ ${r.windowStart})`;
          this.logger.warn(`❌ ${contract.contractCode} - ${description}`);
          await this.prisma.slaEventLog.create({
            data: { contractId, kpiCode: r.kpiCode, metricValue: r.actual, isViolation: true, description },
          });
        }
      } catch (err: any) {
        this.logger.error(`Không mở được vụ vi phạm cho ${contract.contractCode}: ${err?.message}`);
      }
    }
  }

  // CẤU HÌNH NGUỒN DỮ LIỆU (nhiều nguồn / hợp đồng)
  async listSources(contractId: string) {
    const rows = await this.prisma.oracleConfig.findMany({
      where: { contractId, isActive: true },
      orderBy: { createdAt: 'asc' },
      // Không trả token webhook ra ngoài
      select: { id: true, sourceType: true, endpointUrl: true, paused: true, lastProbedAt: true, createdAt: true },
    });
    // Webhook: endpointUrl chỉ là nhãn bên tạo -> trả ra party, không trả như 1 URL
    return Promise.all(
      rows.map(async (r) =>
        r.sourceType === 'WEBHOOK'
          ? { ...r, endpointUrl: null, party: hookPartyOf(r), last: null }
          : { ...r, party: null, last: r.endpointUrl ? await this.lastProbe(contractId, r.endpointUrl) : null },
      ),
    );
  }

  countSources(contractId: string) {
    return this.prisma.oracleConfig.count({ where: { contractId, isActive: true } });
  }

  // Thêm 1 URL HTTP Health Check (không thay URL cũ)
  async setHttpCheck(contractId: string, endpointUrl: string) {
    const url = this.validateUrl(endpointUrl);
    const dup = await this.prisma.oracleConfig.findFirst({
      where: { contractId, sourceType: 'HTTP_CHECK', endpointUrl: url, isActive: true },
    });
    if (dup) throw new Error('URL này đã được giám sát');
    return this.prisma.oracleConfig.create({
      data: { contractId, sourceType: 'HTTP_CHECK', endpointUrl: url, isActive: true },
      select: { id: true, sourceType: true, endpointUrl: true, paused: true, createdAt: true },
    });
  }

  // Mỗi bên có 1 địa chỉ webhook riêng (client = bên mua, provider = nhà cung cấp).
  // Tạo lại = đổi token của chính bên mình (địa chỉ cũ hết hiệu lực), token chỉ hiện 1 lần.
  async setWebhook(contractId: string, publicBaseUrl: string, party: HookParty) {
    const mine = webhooksOf(await this.prisma.oracleConfig.findMany({ where: { contractId, sourceType: 'WEBHOOK', isActive: true } })).filter(
      (h) => hookPartyOf(h) === party,
    );
    if (mine.length) {
      await this.prisma.oracleConfig.updateMany({ where: { id: { in: mine.map((h) => h.id) } }, data: { isActive: false } });
    }
    const token = randomBytes(24).toString('hex');
    await this.prisma.oracleConfig.create({
      data: { contractId, sourceType: 'WEBHOOK', endpointUrl: party, apiKeySecret: token, isActive: true },
    });
    return {
      sourceType: 'WEBHOOK',
      party,
      webhookUrl: `${publicBaseUrl}/api/webhooks/${contractId}?token=${token}`,
      note: 'Lưu URL này lại, token chỉ hiển thị 1 lần.',
    };
  }

  async hasWebhook(contractId: string, party: HookParty) {
    const hooks = await this.prisma.oracleConfig.findMany({ where: { contractId, sourceType: 'WEBHOOK', isActive: true } });
    return hooks.some((h) => hookPartyOf(h) === party);
  }

  // Gỡ 1 nguồn (giữ lịch sử đo)
  async removeSource(contractId: string, configId: string) {
    const r = await this.prisma.oracleConfig.updateMany({
      where: { id: configId, contractId, isActive: true },
      data: { isActive: false },
    });
    if (!r.count) throw new Error('Không tìm thấy nguồn dữ liệu');
    return { removed: true };
  }

  // Trạng thái giám sát hiển thị cho hai bên: admin tạm dừng / đang tạm giữ mở vụ phạt do có khiếu nại
  async monitoringState(contractId: string) {
    const [active, paused, challenged] = await Promise.all([
      this.prisma.oracleConfig.count({ where: { contractId, isActive: true } }),
      this.prisma.oracleConfig.count({ where: { contractId, isActive: true, paused: true } }),
      this.prisma.violationCase.count({ where: { contractId, status: 'CHALLENGED' } }),
    ]);
    return { pausedByAdmin: active > 0 && paused === active, penaltyHold: challenged > 0 };
  }

  // Tạm dừng / tiếp tục giám sát toàn bộ nguồn của hợp đồng (giữ cấu hình). Chỉ admin nền tảng gọi.
  async setMonitoring(contractId: string, enabled: boolean) {
    const n = await this.countSources(contractId);
    if (!n) throw new Error('Hợp đồng chưa có nguồn dữ liệu');
    await this.prisma.oracleConfig.updateMany({ where: { contractId, isActive: true }, data: { paused: !enabled } });
    return { contractId, monitoring: enabled };
  }

  // Chặn URL nội bộ để server không bị lợi dụng dò mạng nội bộ (SSRF)
  // Kiểm tra URL HTTP Health Check trước khi dùng: đúng định dạng + gọi thử phải trả lời bình thường.
  // Báo lỗi ngay lúc nhập, không để hợp đồng chạy rồi mới phát hiện mọi lần đo đều DOWN.
  async verifyHttpUrl(raw: string): Promise<string> {
    const url = this.validateUrl(raw);
    const probe = await this.probeHttp(url);
    if (!probe.isUp) {
      const reason = /HTTP 40[45]/.test(probe.detail)
        ? `trả về ${probe.detail}: địa chỉ không tồn tại hoặc không nhận yêu cầu kiểm tra (GET)`
        : `không trả lời bình thường (${probe.detail})`;
      throw new Error(`Đã gọi thử URL nhưng ${reason}. ${URL_HINT}`);
    }
    return url;
  }

  private validateUrl(raw: string): string {
    let u: URL;
    try {
      u = new URL(String(raw ?? '').trim());
    } catch {
      throw new Error(`URL không đúng định dạng. ${URL_HINT}`);
    }
    if (!['http:', 'https:'].includes(u.protocol)) throw new Error(`URL phải bắt đầu bằng https:// (hoặc http://). ${URL_HINT}`);
    // Địa chỉ webhook chỉ nhận dữ liệu gửi đến (POST): đo bằng GET luôn lỗi 404 -> mọi lần đo đều DOWN
    if (u.pathname.includes('/api/webhooks/')) {
      throw new Error(`Đây là địa chỉ webhook (nơi nhận dữ liệu gửi đến), không dùng làm URL health check. ${URL_HINT}`);
    }
    // Nhầm tên miền giao diện (frontend) với backend khi demo
    if (u.pathname.includes('/api/demo-provider/') && (u.hostname.endsWith('.vercel.app') || FRONTEND_HOSTS.includes(u.hostname))) {
      throw new Error(`Đây là tên miền giao diện (frontend), không có dịch vụ demo. Hãy dùng địa chỉ backend, VD: ${DEMO_URL_EXAMPLE}`);
    }
    const h = u.hostname;
    if (
      h === 'localhost' ||
      h.startsWith('127.') ||
      h.startsWith('10.') ||
      h.startsWith('192.168.') ||
      h.startsWith('169.254.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      h === '0.0.0.0' ||
      h === '[::1]'
    ) {
      throw new Error(`Không giám sát được địa chỉ nội bộ (localhost, mạng LAN). ${URL_HINT}`);
    }
    return u.toString();
  }
}
