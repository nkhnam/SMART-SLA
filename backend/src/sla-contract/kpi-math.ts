// CÔNG THỨC DÙNG CHUNG: khung loại trừ, mức vi phạm, service credit
import { CreditTier, Exclusion } from './kpi-catalog';

const VN_OFFSET_MS = 7 * 3600 * 1000; // Khung loại trừ tính theo giờ Việt Nam (UTC+7)

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

// Thời điểm t có rơi vào khung loại trừ (VD: bảo trì 02:00-04:00 sáng Chủ nhật) không?
export function isExcluded(t: number, exclusions: Exclusion[] | null | undefined): boolean {
  if (!exclusions?.length) return false;
  const vn = new Date(t + VN_OFFSET_MS);
  const day = vn.getUTCDay();
  const minute = vn.getUTCHours() * 60 + vn.getUTCMinutes();
  return exclusions.some((e) => e.dayOfWeek === day && minute >= toMinutes(e.start) && minute < toMinutes(e.end));
}

// Tổng thời gian (ms) KHÔNG thuộc khung loại trừ trong đoạn [from, to) - bước 1 phút
export function countedMs(from: number, to: number, exclusions: Exclusion[] | null | undefined): number {
  if (to <= from) return 0;
  if (!exclusions?.length) return to - from;
  let total = 0;
  for (let t = from; t < to; t += 60_000) {
    const step = Math.min(60_000, to - t);
    if (!isExcluded(t, exclusions)) total += step;
  }
  return total;
}

// Mức vi phạm:
//   GTE (Uptime): số điểm % hụt so với cam kết      (99.9 -> 99.2 = 0.7)
//   LTE (thời gian): số % vượt ngưỡng               (200ms -> 300ms = 50)
export function breachAmount(comparator: string, target: number, actual: number): number {
  if (comparator === 'GTE') return Math.max(0, target - actual);
  return Math.max(0, ((actual - target) / target) * 100);
}

export function isBreached(comparator: string, target: number, actual: number): boolean {
  return comparator === 'GTE' ? actual < target : actual > target;
}

// Chọn bậc service credit theo điều khoản của chính hợp đồng
export function creditFromTiers(tiers: CreditTier[], breach: number): number {
  const sorted = [...(tiers ?? [])].sort((a, b) => (a.maxBreach ?? Infinity) - (b.maxBreach ?? Infinity));
  const tier = sorted.find((t) => t.maxBreach === null || breach < t.maxBreach);
  return tier?.creditBps ?? 0;
}
