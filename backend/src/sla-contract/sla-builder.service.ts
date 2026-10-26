import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreditTier,
  DATA_SOURCES,
  DEFAULT_WINDOW_MINUTES,
  Exclusion,
  KPI_CATALOG,
  KpiInput,
  TEMPLATES,
} from './kpi-catalog';

export type NormalizedKpi = {
  kpiCode: string;
  name: string;
  unit: string;
  comparator: string;
  target: number;
  dataSource: string;
  windowMinutes: number;
  exclusions: Exclusion[];
  creditTiers: CreditTier[];
  minPercent: number | null;
};

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

@Injectable()
export class SlaBuilderService implements OnModuleInit {
  private readonly logger = new Logger(SlaBuilderService.name);

  constructor(private prisma: PrismaService) {}

  // Dữ liệu cho màn hình SLA Builder: thư viện KPI, nguồn dữ liệu, template theo ngành
  getCatalog() {
    return {
      kpis: Object.entries(KPI_CATALOG).map(([code, k]) => ({ code, ...k })),
      dataSources: Object.entries(DATA_SOURCES).map(([code, label]) => ({ code, label })),
      templates: Object.entries(TEMPLATES).map(([code, t]) => ({
        code,
        ...t,
        kpis: t.kpis.map((k) => this.normalizeKpi(k)),
      })),
    };
  }

  // Kiểm tra + chuẩn hoá 1 KPI người dùng cấu hình
  normalizeKpi(k: KpiInput): NormalizedKpi {
    const meta = KPI_CATALOG[k?.kpiCode];
    if (!meta) throw new BadRequestException(`KPI không hợp lệ: ${k?.kpiCode}`);

    const target = Number(k.target);
    if (!Number.isFinite(target) || target <= 0) {
      throw new BadRequestException(`Ngưỡng cam kết của ${meta.name} phải là số dương`);
    }
    if (meta.unit === '%' && target > 100) {
      throw new BadRequestException(`${meta.name} không được vượt quá 100%`);
    }
    if (meta.maxTarget !== undefined && target > meta.maxTarget) {
      throw new BadRequestException(`Cam kết ${meta.name} tối đa ${meta.maxTarget}${meta.unit}`);
    }

    const dataSource = String(k.dataSource ?? meta.sources[0]);
    if (!meta.sources.includes(dataSource)) {
      throw new BadRequestException(`${meta.name} chỉ đo được bằng: ${meta.sources.join(', ')}`);
    }

    const windowMinutes = Math.round(Number(k.windowMinutes ?? DEFAULT_WINDOW_MINUTES));
    if (!Number.isFinite(windowMinutes) || windowMinutes < 5) {
      throw new BadRequestException('Kỳ đo tối thiểu 5 phút');
    }

    const exclusions = (k.exclusions ?? []).map((e) => {
      const day = Number(e?.dayOfWeek);
      if (!Number.isInteger(day) || day < 0 || day > 6) {
        throw new BadRequestException('Ngày loại trừ phải từ 0 (Chủ nhật) đến 6 (Thứ bảy)');
      }
      if (!TIME_RE.test(e?.start) || !TIME_RE.test(e?.end) || e.start >= e.end) {
        throw new BadRequestException('Khung giờ loại trừ không hợp lệ (dạng HH:mm, bắt đầu < kết thúc)');
      }
      return { dayOfWeek: day, start: e.start, end: e.end, note: e.note?.slice(0, 100) };
    });

    const creditTiers = this.normalizeTiers(k.creditTiers ?? meta.defaultTiers, meta.name);

    // KPI ticket: thêm tỷ lệ tối thiểu số ticket đạt ngưỡng
    let minPercent: number | null = null;
    if (meta.defaultMinPercent !== undefined) {
      minPercent = Number(k.minPercent ?? meta.defaultMinPercent);
      if (!Number.isFinite(minPercent) || minPercent <= 0 || minPercent > 100) {
        throw new BadRequestException(`${meta.name}: tỷ lệ tối thiểu phải từ 1% đến 100%`);
      }
    }

    return {
      kpiCode: k.kpiCode,
      name: meta.name,
      unit: meta.unit,
      comparator: meta.comparator,
      target,
      dataSource,
      windowMinutes,
      exclusions,
      creditTiers,
      minPercent,
    };
  }

  private normalizeTiers(tiers: CreditTier[], kpiName: string): CreditTier[] {
    if (!Array.isArray(tiers) || tiers.length === 0 || tiers.length > 5) {
      throw new BadRequestException(`${kpiName}: cần từ 1 đến 5 bậc service credit`);
    }
    const out = tiers.map((t) => ({
      maxBreach: t?.maxBreach === null || t?.maxBreach === undefined ? null : Number(t.maxBreach),
      creditBps: Math.round(Number(t?.creditBps)),
    }));
    for (const t of out) {
      if (!Number.isFinite(t.creditBps) || t.creditBps < 0 || t.creditBps > 10000) {
        throw new BadRequestException(`${kpiName}: mức hoàn phí phải từ 0% đến 100%`);
      }
      if (t.maxBreach !== null && (!Number.isFinite(t.maxBreach) || t.maxBreach <= 0)) {
        throw new BadRequestException(`${kpiName}: mức vi phạm của mỗi bậc phải là số dương`);
      }
    }
    // Sắp xếp: bậc nhẹ trước, bậc "không giới hạn" (null) cuối cùng
    out.sort((a, b) => (a.maxBreach ?? Infinity) - (b.maxBreach ?? Infinity));
    if (out[out.length - 1].maxBreach !== null) {
      throw new BadRequestException(`${kpiName}: bậc cuối cùng phải là "không giới hạn" (maxBreach = null)`);
    }
    return out;
  }

  // Dựng danh sách KPI cho hợp đồng mới: từ KPI tự cấu hình > template > dạng cũ (uptime + responseTime)
  buildKpis(data: any): { kpis: NormalizedKpi[]; challengeWindowHours: number; serviceName?: string } {
    const tpl = data?.templateCode ? TEMPLATES[data.templateCode] : undefined;
    if (data?.templateCode && !tpl) throw new BadRequestException(`Template không tồn tại: ${data.templateCode}`);

    let raw: KpiInput[];
    if (Array.isArray(data?.kpis) && data.kpis.length) {
      raw = data.kpis;
    } else if (tpl) {
      raw = tpl.kpis;
    } else {
      // Tương thích giao diện cũ
      raw = [
        { kpiCode: 'UPTIME', target: parseFloat(data?.uptime) || 99.9, dataSource: 'HTTP_CHECK' },
        { kpiCode: 'RESPONSE_TIME', target: parseInt(data?.responseTime) || 200, dataSource: 'HTTP_CHECK' },
      ];
    }
    if (raw.length > 8) throw new BadRequestException('Tối đa 8 KPI mỗi hợp đồng');

    const kpis = raw.map((k) => this.normalizeKpi(k));
    const codes = kpis.map((k) => k.kpiCode);
    if (new Set(codes).size !== codes.length) throw new BadRequestException('Mỗi loại KPI chỉ được khai báo 1 lần');

    const hours = Number(data?.challengeWindowHours ?? tpl?.challengeWindowHours ?? 72);
    // Tối thiểu 24 giờ để bên bị bất lợi kịp phản đối (dưới 24 giờ rất dễ bị bỏ lỡ)
    if (!Number.isFinite(hours) || hours < 24 || hours > 168) {
      throw new BadRequestException('Thời hạn phản đối phải từ 24 đến 168 giờ');
    }

    return { kpis, challengeWindowHours: hours, serviceName: tpl?.serviceName };
  }

  // Tóm tắt điều khoản phạt thành câu chữ (lưu vào penaltyRule để hiển thị)
  describePenalty(kpis: NormalizedKpi[]): string {
    return kpis
      .map((k) => {
        if (k.minPercent !== null) {
          const tiers = k.creditTiers
            .map((t) => (t.maxBreach === null ? `nặng hơn: hoàn ${t.creditBps / 100}%` : `hụt dưới ${t.maxBreach} điểm %: hoàn ${t.creditBps / 100}%`))
            .join('; ');
          return `${k.name} ≤ ${k.target} ${k.unit} cho ≥ ${k.minPercent}% ticket (${tiers})`;
        }
        const word = k.comparator === 'GTE' ? 'hụt' : 'vượt';
        const tiers = k.creditTiers
          .map((t) =>
            t.maxBreach === null
              ? `nặng hơn: hoàn ${t.creditBps / 100}%`
              : `${word} dưới ${t.maxBreach}%: hoàn ${t.creditBps / 100}%`,
          )
          .join('; ');
        return `${k.name} ${k.comparator === 'GTE' ? '≥' : '≤'} ${k.target}${k.unit} (${tiers})`;
      })
      .join(' | ');
  }

  // Tương thích ngược: hợp đồng cũ chưa có KPI -> tự tạo từ uptimeTarget + responseMaxMs
  async onModuleInit() {
    try {
      const legacy = await this.prisma.slaContract.findMany({ where: { kpis: { none: {} } } });
      for (const c of legacy) {
        const kpis = [
          this.normalizeKpi({ kpiCode: 'UPTIME', target: c.uptimeTarget, dataSource: 'HTTP_CHECK' }),
          this.normalizeKpi({ kpiCode: 'RESPONSE_TIME', target: c.responseMaxMs, dataSource: 'HTTP_CHECK' }),
        ];
        await this.prisma.slaKpi.createMany({
          data: kpis.map((k) => ({ contractId: c.id, ...k, exclusions: k.exclusions as any, creditTiers: k.creditTiers as any })),
        });
      }
      if (legacy.length) this.logger.log(`Đã chuyển ${legacy.length} hợp đồng cũ sang cấu trúc KPI mới`);
    } catch (err: any) {
      this.logger.error(`Chuyển đổi hợp đồng cũ thất bại: ${err?.message}`);
    }
  }

  // Điều kiện bổ sung: tối đa 20 điều, mỗi điều 1-1000 ký tự
  normalizeConditions(raw: unknown): string[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new BadRequestException('Điều kiện bổ sung phải là danh sách');
    const list = raw.map((c) => (typeof c === 'string' ? c.trim() : ''));
    if (list.some((c) => !c)) throw new BadRequestException('Có điều kiện bổ sung bị trống, hãy điền nội dung hoặc xoá');
    if (list.length > 20) throw new BadRequestException('Tối đa 20 điều kiện bổ sung');
    if (list.some((c) => c.length > 1000)) throw new BadRequestException('Mỗi điều kiện bổ sung tối đa 1000 ký tự');
    return list;
  }
}
