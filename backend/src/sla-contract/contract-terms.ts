// GIÁ TRỊ HỢP ĐỒNG + THỜI HẠN HIỆU LỰC + NHÃN MỨC PHẠT (dùng chung)
import { BadRequestException } from '@nestjs/common';
import { CreditTier } from './kpi-catalog';

const VN_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;
const MAX_VALUE_VND = 1e13; // 10.000 tỷ
const MAX_TERM_DAYS = 3660; // ~10 năm

// 'YYYY-MM-DD' (ngày theo giờ Việt Nam) -> thời điểm 00:00 giờ VN
export function parseVnDate(raw: unknown, label: string): Date {
  const s = String(raw ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new BadRequestException(`${label} không hợp lệ (định dạng YYYY-MM-DD)`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = Date.UTC(y, mo - 1, d) - VN_OFFSET_MS;
  const check = new Date(t + VN_OFFSET_MS);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    throw new BadRequestException(`${label} không tồn tại`);
  }
  return new Date(t);
}

// Thời điểm -> 'YYYY-MM-DD' theo giờ Việt Nam
export function vnDateString(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  return new Date(new Date(d).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
}

// Ngày hết hạn tính trọn ngày: hiệu lực đến hết 23:59:59 ngày đó (giờ VN)
export function effectiveEndMs(effectiveTo: Date | null | undefined): number | null {
  return effectiveTo ? new Date(effectiveTo).getTime() + DAY_MS : null;
}

export type TermState = 'NOT_STARTED' | 'IN_EFFECT' | 'EXPIRED' | 'UNSET';

export function termState(c: { effectiveFrom?: Date | null; effectiveTo?: Date | null }, now = Date.now()): TermState {
  if (!c.effectiveFrom && !c.effectiveTo) return 'UNSET';
  if (c.effectiveFrom && now < new Date(c.effectiveFrom).getTime()) return 'NOT_STARTED';
  const end = effectiveEndMs(c.effectiveTo);
  if (end !== null && now >= end) return 'EXPIRED';
  return 'IN_EFFECT';
}

// Oracle chỉ đo khi hợp đồng đang trong thời hạn (hợp đồng cũ không có ngày -> luôn đo như trước)
export function isInEffect(c: { effectiveFrom?: Date | null; effectiveTo?: Date | null }, now = Date.now()): boolean {
  const s = termState(c, now);
  return s === 'IN_EFFECT' || s === 'UNSET';
}

export type ContractTerms = { contractValueVnd: number; effectiveFrom: Date; effectiveTo: Date };

// Kiểm tra giá trị + thời hạn. fallback = giá trị cũ (sửa điều khoản: trường nào không gửi thì giữ nguyên)
export function normalizeContractTerms(
  data: any,
  fallback?: { contractValueVnd?: number | null; effectiveFrom?: Date | null; effectiveTo?: Date | null },
): ContractTerms {
  const rawValue = data?.contractValueVnd;
  let value: number | null | undefined;
  if (rawValue === undefined && fallback) value = fallback.contractValueVnd;
  else {
    if (rawValue === undefined || rawValue === null || rawValue === '') throw new BadRequestException('Cần nhập giá trị hợp đồng (VNĐ/tháng)');
    value = Number(typeof rawValue === 'string' ? rawValue.replace(/[.,\s]/g, '') : rawValue);
    if (!Number.isFinite(value) || value < 1000) throw new BadRequestException('Giá trị hợp đồng phải từ 1.000 VNĐ trở lên');
    if (value > MAX_VALUE_VND) throw new BadRequestException('Giá trị hợp đồng quá lớn');
    value = Math.round(value);
  }
  if (value === null || value === undefined) throw new BadRequestException('Cần nhập giá trị hợp đồng (VNĐ/tháng)');

  const from = data?.effectiveFrom === undefined && fallback?.effectiveFrom ? fallback.effectiveFrom : parseVnDate(data?.effectiveFrom, 'Ngày hiệu lực');
  const to = data?.effectiveTo === undefined && fallback?.effectiveTo ? fallback.effectiveTo : parseVnDate(data?.effectiveTo, 'Ngày hết hạn');
  if (to.getTime() < from.getTime()) throw new BadRequestException('Ngày hết hạn phải sau hoặc trùng ngày hiệu lực');
  if ((to.getTime() - from.getTime()) / DAY_MS > MAX_TERM_DAYS) throw new BadRequestException('Thời hạn hợp đồng tối đa 10 năm');
  return { contractValueVnd: value, effectiveFrom: from, effectiveTo: to };
}

// Nhãn mức phạt (tiếng Anh) theo vị trí bậc: bậc nhẹ nhất = Minor, nặng nhất = Severe, ở giữa = Moderate
export const SEVERITY = ['Minor', 'Moderate', 'Severe'] as const;
export type Severity = (typeof SEVERITY)[number];

export function severityOf(index: number, count: number): Severity {
  if (count <= 1 || index >= count - 1) return 'Severe';
  if (index === 0) return 'Minor';
  return 'Moderate';
}

export function sortTiers(tiers: CreditTier[]): CreditTier[] {
  return [...(tiers ?? [])].sort((a, b) => (a.maxBreach ?? Infinity) - (b.maxBreach ?? Infinity));
}

// Mức phạt của 1 vụ vi phạm: tìm bậc có đúng creditBps đã áp (bậc nhẹ nhất nếu trùng)
export function severityForCredit(tiers: CreditTier[], creditBps: number): Severity | null {
  const sorted = sortTiers(tiers);
  const i = sorted.findIndex((t) => t.creditBps === creditBps);
  return i < 0 ? null : severityOf(i, sorted.length);
}

// Số tiền hoàn phí (VNĐ) = giá trị hợp đồng x % hoàn phí
export function creditAmountVnd(contractValueVnd: number | null | undefined, creditBps: number): number | null {
  if (!contractValueVnd) return null;
  return Math.round((contractValueVnd * creditBps) / 10_000);
}

// TRẦN PHẠT (Điều 301 Luật Thương mại: tối đa 8% giá trị hợp đồng)
export const PENALTY_CAP_PERCENT = Number(process.env.PENALTY_CAP_PERCENT) || 8;
// Mức cảnh báo trước cho nhà cung cấp (% tổng giá trị hợp đồng)
export const PENALTY_WARN_LEVELS = [5, 7].filter((x) => x < PENALTY_CAP_PERCENT);
const MONTH_MS = (365 / 12) * DAY_MS;

// Số tháng hiệu lực (tính theo ngày, 1 năm = 12 tháng)
export function termMonths(c: { effectiveFrom?: Date | null; effectiveTo?: Date | null }): number | null {
  if (!c.effectiveFrom || !c.effectiveTo) return null;
  const end = effectiveEndMs(c.effectiveTo)!;
  return Math.max(0, (end - new Date(c.effectiveFrom).getTime()) / MONTH_MS);
}

// Tổng giá trị hợp đồng = giá trị/tháng x số tháng hiệu lực
export function totalContractValueVnd(c: { contractValueVnd?: number | null; effectiveFrom?: Date | null; effectiveTo?: Date | null }): number | null {
  const m = termMonths(c);
  if (!c.contractValueVnd || m === null) return null;
  return Math.round(c.contractValueVnd * m);
}
