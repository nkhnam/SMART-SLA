import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationService } from './notification.service';
import { PENALTY_CAP_PERCENT, PENALTY_WARN_LEVELS, totalContractValueVnd } from './contract-terms';

// TRẦN PHẠT 8% TỔNG GIÁ TRỊ HỢP ĐỒNG
//   - Cộng dồn tiền hoàn phí ĐÃ CHỐT (SETTLED / UPHELD) của cả hợp đồng.
//   - Vụ làm vượt trần chỉ áp phần còn lại tới đúng 8% (creditVndApplied).
//   - Đạt 5%, 7%: báo trước cho nhà cung cấp (mỗi mức 1 lần).
//   - Chạm 8%: dừng hợp đồng (TERMINATED, ngừng đo) và báo cả hai bên.
// Hợp đồng chưa có giá trị / thời hạn (tạo trước bản cập nhật) -> không áp trần.
const APPLIED = ['SETTLED', 'UPHELD'];

export type PenaltyCapState = {
  capPercent: number;
  warnLevels: number[];
  totalValueVnd: number;
  capVnd: number;
  appliedVnd: number;
  percent: number;
  warnedLevels: number[];
  reachedAt: string | null;
};

const fmtVnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')} VNĐ`;

@Injectable()
export class PenaltyCapService {
  private readonly logger = new Logger(PenaltyCapService.name);

  constructor(
    private prisma: PrismaService,
    private notifier: NotificationService,
  ) {}

  // Tính lại tiền hoàn thực áp của từng vụ đã chốt + trạng thái trần (không gửi thông báo)
  async compute(contractId: string): Promise<PenaltyCapState | null> {
    const c = await this.prisma.slaContract.findUnique({ where: { id: contractId } });
    if (!c) return null;
    const total = totalContractValueVnd(c);
    if (!total || !c.contractValueVnd) return null;
    const capVnd = Math.round((total * PENALTY_CAP_PERCENT) / 100);

    const cases = await this.prisma.violationCase.findMany({
      where: { contractId, status: { in: APPLIED } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, creditBps: true, creditVndApplied: true },
    });
    let running = 0;
    for (const v of cases) {
      const raw = Math.round((c.contractValueVnd * v.creditBps) / 10_000);
      const applied = Math.max(0, Math.min(raw, capVnd - running));
      running += applied;
      if (v.creditVndApplied !== applied) {
        await this.prisma.violationCase.update({ where: { id: v.id }, data: { creditVndApplied: applied } });
      }
    }
    const prev = (c.penaltyCap as any) ?? {};
    return {
      capPercent: PENALTY_CAP_PERCENT,
      warnLevels: PENALTY_WARN_LEVELS,
      totalValueVnd: total,
      capVnd,
      appliedVnd: running,
      percent: Number(((running / total) * 100).toFixed(2)),
      warnedLevels: Array.isArray(prev.warnedLevels) ? prev.warnedLevels : [],
      reachedAt: prev.reachedAt ?? null,
    };
  }

  // Gọi sau mỗi lần 1 vụ được chốt: cảnh báo / dừng hợp đồng nếu cần
  async check(contractId: string) {
    const state = await this.compute(contractId);
    if (!state) return null;
    const c = await this.prisma.slaContract.findUnique({
      where: { id: contractId },
      include: { provider: { select: { organizationId: true } } },
    });
    if (!c) return null;

    const reached = state.appliedVnd >= state.capVnd;
    // Mức cảnh báo vừa vượt mà chưa báo. Nhảy thẳng tới trần -> chỉ báo dừng hợp đồng.
    const crossed = PENALTY_WARN_LEVELS.filter((l) => state.percent >= l && !state.warnedLevels.includes(l));
    const warnedLevels = [...new Set([...state.warnedLevels, ...crossed])].sort((a, b) => a - b);
    const next: PenaltyCapState = { ...state, warnedLevels, reachedAt: state.reachedAt ?? (reached ? new Date().toISOString() : null) };

    const supplierOrg = c.provider?.organizationId ?? null;
    const both = [c.clientId, supplierOrg].filter(Boolean) as string[];
    const summary = `Tổng hoàn phí đã chốt ${fmtVnd(state.appliedVnd)} = ${state.percent}% tổng giá trị hợp đồng ${fmtVnd(state.totalValueVnd)}`;

    if (reached && !state.reachedAt) {
      await this.prisma.slaContract.update({ where: { id: c.id }, data: { status: 'TERMINATED', penaltyCap: next as any } });
      await this.notify(
        both,
        c.id,
        'PENALTY_CAP_REACHED',
        `${c.contractCode}: chạm trần phạt ${PENALTY_CAP_PERCENT}%, hợp đồng đã dừng`,
        `${summary}, đạt trần phạt ${PENALTY_CAP_PERCENT}% theo quy định. SMART-SLA đã dừng hợp đồng ${c.contractCode} (${c.serviceName}) và ngừng đo. Hai bên làm việc tiếp về thanh lý hoặc ký hợp đồng mới.`,
      );
      this.logger.warn(`⛔ ${c.contractCode} chạm trần phạt ${PENALTY_CAP_PERCENT}% -> TERMINATED`);
      return next;
    }

    if (crossed.length && !reached) {
      const level = Math.max(...crossed);
      const left = state.capVnd - state.appliedVnd;
      await this.notify(
        supplierOrg ? [supplierOrg] : [],
        c.id,
        'PENALTY_CAP_WARNING',
        `${c.contractCode}: tiền phạt đã đạt ${level}% giá trị hợp đồng`,
        `${summary}. Còn ${fmtVnd(left)} nữa là chạm trần ${PENALTY_CAP_PERCENT}% và hợp đồng sẽ tự dừng. Vui lòng rà soát chất lượng dịch vụ.`,
      );
      this.logger.warn(`⚠️ ${c.contractCode} tiền phạt đạt ${state.percent}% (mức báo ${level}%)`);
    }

    await this.prisma.slaContract.update({ where: { id: c.id }, data: { penaltyCap: next as any } });
    return next;
  }

  private async notify(orgIds: string[], contractId: string, type: string, title: string, message: string) {
    if (!orgIds.length) return;
    await this.prisma.notification.createMany({ data: orgIds.map((organizationId) => ({ organizationId, contractId, type, title, message })) });
    if (!this.notifier.canSendDirectEmail) return;
    const users = await this.prisma.user.findMany({
      where: { organizationId: { in: orgIds }, isActive: true, role: 'ADMIN' },
      select: { email: true },
    });
    for (const u of users) {
      this.notifier.sendDirectEmail(u.email, `[SMART-SLA] ${title}`, message).catch((e) => this.logger.warn(`Gửi email trần phạt lỗi: ${e?.message}`));
    }
  }
}
