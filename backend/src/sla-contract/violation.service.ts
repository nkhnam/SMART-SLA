import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { Web3Service } from './web3.service';
import { ContractAccessService } from './contract-access.service';
import { AuthUser } from '../auth/auth.guard';
import { CreditTier } from './kpi-catalog';
import { breachAmount, creditFromTiers } from './kpi-math';
import { NotificationService } from './notification.service';
import { PenaltyCapService } from './penalty-cap.service';

// Thời hạn phản đối lấy theo TỪNG HỢP ĐỒNG (SLA Builder, mặc định 48h).
// Demo: đặt CHALLENGE_WINDOW_SECONDS=300 để ép mọi hợp đồng về 5 phút cho nhanh.
const WINDOW_OVERRIDE = Number(process.env.CHALLENGE_WINDOW_SECONDS) || 0;
const DEMO_WINDOW_MINUTES = Number(process.env.ORACLE_DEMO_WINDOW_MINUTES) || 0;

// Chờ thêm vài giây sau hạn chót để chắc chắn blockchain cũng đã qua hạn
const SETTLE_BUFFER_MS = 30_000;

@Injectable()
export class ViolationService {
  private readonly logger = new Logger(ViolationService.name);
  private busy = false; // tránh 2 lượt cron chạy chồng nhau

  constructor(
    private prisma: PrismaService,
    private web3: Web3Service,
    private access: ContractAccessService,
    private notifier: NotificationService,
    private cap: PenaltyCapService,
  ) {}

  private windowSecondsOf(contract: { challengeWindowSeconds: number }) {
    return WINDOW_OVERRIDE || contract.challengeWindowSeconds;
  }

  // Đảm bảo hash SLA đã nằm trên chain (kiểm tra thật on-chain, thiếu thì ghi bù)
  private async ensureSlaOnChain(contractId: string): Promise<string | null> {
    const contract = await this.prisma.slaContract.findUnique({
      where: { id: contractId },
      include: { kpis: true, oracleConfigs: { where: { isActive: true } } },
    });
    if (!contract) return null;

    const slaHash = contract.slaHash ?? this.web3.computeSlaHash(contract);
    if (await this.web3.isSlaRegistered(slaHash)) {
      if (!contract.slaHash) {
        await this.prisma.slaContract.update({ where: { id: contractId }, data: { slaHash } });
      }
      return slaHash;
    }

    const res = await this.web3.registerSla(contract);
    if (!res.txHash) return null;
    await this.prisma.slaContract.update({
      where: { id: contractId },
      data: { slaHash: res.slaHash, txHash: res.txHash },
    });
    return res.slaHash;
  }

  // Ghi bằng chứng lên chain; thành công thì mở lại đồng hồ Challenge Window cho khớp on-chain
  private async recordOnChain(caseId: string): Promise<boolean> {
    const vc = await this.prisma.violationCase.findUnique({ where: { id: caseId } });
    if (!vc || vc.recordTxHash) return !!vc?.recordTxHash;

    const slaHash = await this.ensureSlaOnChain(vc.contractId);
    if (!slaHash) return false;

    const contract = await this.prisma.slaContract.findUnique({ where: { id: vc.contractId } });
    const windowSeconds = this.windowSecondsOf(contract!);

    const recordTxHash = await this.web3.recordViolation(vc.evidenceHash, slaHash, vc.creditBps, windowSeconds);
    if (!recordTxHash) return false;

    await this.prisma.violationCase.update({
      where: { id: caseId },
      data: {
        recordTxHash,
        challengeDeadline: new Date(Date.now() + windowSeconds * 1000),
      },
    });
    this.notifier.fire('VIOLATION_OPENED', caseId);
    return true;
  }

  // Mở 1 vụ vi phạm cho 1 KPI: tạo bằng chứng -> ghi on-chain -> mở Challenge Window
  // Mỗi KPI tối đa 1 vụ trong 1 kỳ đo (giống thực tế: service credit tính theo kỳ, tránh đốt phí gas)
  async openCase(
    contractId: string,
    kpi: { kpiCode: string; comparator: string; target: number; windowMinutes: number; creditTiers: any },
    actualValue: number,
  ) {
    const contract = await this.prisma.slaContract.findUnique({
      where: { id: contractId },
      include: { kpis: true, oracleConfigs: { where: { isActive: true } } },
    });
    if (!contract) throw new NotFoundException('Không tìm thấy hợp đồng');

    const periodStart = new Date(Date.now() - (DEMO_WINDOW_MINUTES || kpi.windowMinutes) * 60_000);
    const existing = await this.prisma.violationCase.findFirst({
      where: {
        contractId,
        kpiCode: kpi.kpiCode,
        OR: [{ status: 'PENDING' }, { createdAt: { gte: periodStart } }],
      },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return { ...existing, isNew: false };

    const detectedAt = new Date();
    const breach = breachAmount(kpi.comparator, kpi.target, actualValue);
    const creditBps = creditFromTiers(kpi.creditTiers as CreditTier[], breach);
    const slaHash = contract.slaHash ?? this.web3.computeSlaHash(contract);
    const evidenceHash = this.web3.computeEvidenceHash({
      contractCode: contract.contractCode,
      slaHash,
      kpiCode: kpi.kpiCode,
      targetValue: kpi.target,
      actualValue,
      detectedAt,
    });

    const vc = await this.prisma.violationCase.create({
      data: {
        contractId: contract.id,
        kpiCode: kpi.kpiCode,
        targetValue: kpi.target,
        actualValue,
        creditBps,
        evidenceHash,
        challengeDeadline: new Date(detectedAt.getTime() + this.windowSecondsOf(contract) * 1000),
        createdAt: detectedAt,
      },
    });

    this.logger.warn(
      `Mở vụ vi phạm ${contract.contractCode} (${kpi.kpiCode}): đo ${actualValue}, cam kết ${kpi.target}, mức vi phạm ${breach.toFixed(2)} -> hoàn ${creditBps / 100}% phí theo điều khoản`,
    );

    // Ghi on-chain ngay; nếu lỗi, cron bên dưới sẽ tự thử lại
    await this.recordOnChain(vc.id);
    const fresh = await this.prisma.violationCase.findUnique({ where: { id: vc.id } });
    return { ...fresh!, isNew: true };
  }

  // Buyer hoặc Supplier phản đối trong thời hạn.
  // "Ai phản đối" được XÁC ĐỊNH TỪ TÀI KHOẢN ĐĂNG NHẬP, không tin vào dữ liệu người dùng tự gửi lên.
  async challenge(id: string, user: AuthUser, reason: string) {
    const vc = await this.prisma.violationCase.findUnique({ where: { id } });
    if (!vc) throw new NotFoundException('Không tìm thấy vụ vi phạm');
    const party = await this.access.assertParty(vc.contractId, user.orgId);

    if (vc.status !== 'PENDING') throw new BadRequestException('Vụ vi phạm không còn ở trạng thái chờ');
    if (!vc.recordTxHash) throw new BadRequestException('Bằng chứng đang được ghi lên blockchain, vui lòng thử lại sau ít phút');
    if (new Date() > vc.challengeDeadline) throw new BadRequestException('Đã hết thời hạn phản đối');
    if (!reason?.trim()) throw new BadRequestException('Cần nhập lý do phản đối');

    const challengeTxHash = await this.web3.challenge(vc.evidenceHash);
    if (!challengeTxHash) throw new BadRequestException('Ghi phản đối lên blockchain thất bại, vui lòng thử lại');

    const updatedCase = await this.prisma.violationCase.update({
      where: { id },
      data: {
        status: 'CHALLENGED',
        challengedBy: party,
        challengedById: user.userId,
        challengeReason: reason.trim().slice(0, 500),
        challengeTxHash,
      },
    });
    this.notifier.fire('CHALLENGED', id);
    return updatedCase;
  }

  // Cron mỗi 30s: (1) thử ghi lại các vụ chưa lên chain, (2) tự chốt các vụ hết hạn
  @Cron(CronExpression.EVERY_30_SECONDS)
  async processCases() {
    if (this.busy) return;
    this.busy = true;
    try {
      // (1) Thử lại các vụ ghi on-chain thất bại
      const notRecorded = await this.prisma.violationCase.findMany({
        where: { status: 'PENDING', recordTxHash: null },
      });
      for (const vc of notRecorded) {
        const ok = await this.recordOnChain(vc.id);
        if (ok) this.logger.log(`Đã ghi bù bằng chứng vụ ${vc.id} lên Polygon`);
      }

      // (1b) Nhắc sắp hết hạn phản đối: còn <= 25% thời hạn, mỗi vụ nhắc 1 lần
      const pendingOnChain = await this.prisma.violationCase.findMany({
        where: { status: 'PENDING', recordTxHash: { not: null }, deadlineNotifiedAt: null },
        include: { contract: { select: { challengeWindowSeconds: true } } },
      });
      for (const vc of pendingOnChain) {
        const windowMs = this.windowSecondsOf(vc.contract) * 1000;
        const remaining = vc.challengeDeadline.getTime() - Date.now();
        if (remaining > 0 && remaining <= windowMs * 0.25) {
          await this.prisma.violationCase.update({ where: { id: vc.id }, data: { deadlineNotifiedAt: new Date() } });
          this.notifier.fire('DEADLINE_SOON', vc.id);
        }
      }

      // (2) Tự chốt: chỉ các vụ ĐÃ lên chain, hết hạn, không ai phản đối
      const expired = await this.prisma.violationCase.findMany({
        where: {
          status: 'PENDING',
          recordTxHash: { not: null },
          challengeDeadline: { lt: new Date(Date.now() - SETTLE_BUFFER_MS) },
        },
      });
      for (const vc of expired) {
        const settleTxHash = await this.web3.settle(vc.evidenceHash);
        if (!settleTxHash) continue; // lỗi -> để lượt sau thử lại, KHÔNG đánh dấu chốt
        await this.prisma.violationCase.update({
          where: { id: vc.id },
          data: { status: 'SETTLED', settleTxHash },
        });
        this.logger.log(`Đã tự động chốt vụ vi phạm ${vc.id} (không có phản đối)`);
        this.notifier.fire('SETTLED', vc.id);
        // Trần phạt 8%: cảnh báo 5% / 7% cho nhà cung cấp, chạm 8% thì dừng hợp đồng
        await this.cap.check(vc.contractId).catch((e) => this.logger.error(`Kiểm tra trần phạt lỗi: ${e?.message}`));
      }
    } finally {
      this.busy = false;
    }
  }

  // Danh sách vụ vi phạm, lọc theo hợp đồng người xem được phép thấy
  findAll(contractScope: any = {}, status?: string) {
    return this.prisma.violationCase.findMany({
      where: { contract: contractScope, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      include: {
        contract: { select: { contractCode: true, serviceName: true } },
      },
    });
  }

  // ADMIN NỀN TẢNG xử lý vụ bị phản đối (xử lý ngoại lệ)
  //   UPHOLD  -> giữ nguyên vi phạm, áp service credit  (status UPHELD)
  //   DISMISS -> chấp nhận phản đối, huỷ vi phạm         (status DISMISSED)
  // Lưu ý MVP: kết quả lưu off-chain; on-chain bằng chứng vẫn ở trạng thái CHALLENGED
  // (SLAContract v2 sẽ thêm hàm resolve() để ghi kết quả lên chain).
  async resolve(id: string, admin: AuthUser, decision: string, note: string) {
    const vc = await this.prisma.violationCase.findUnique({ where: { id } });
    if (!vc) throw new NotFoundException('Không tìm thấy vụ vi phạm');
    if (vc.status !== 'CHALLENGED') throw new BadRequestException('Chỉ xử lý được vụ đang bị phản đối (CHALLENGED)');
    if (!['UPHOLD', 'DISMISS'].includes(decision)) throw new BadRequestException('decision phải là UPHOLD hoặc DISMISS');
    if (!note?.trim()) throw new BadRequestException('Cần ghi lý do quyết định');

    const updated = await this.prisma.violationCase.update({
      where: { id },
      data: {
        status: decision === 'UPHOLD' ? 'UPHELD' : 'DISMISSED',
        resolution: decision,
        resolutionNote: note.trim().slice(0, 1000),
        resolvedById: admin.userId,
        resolvedAt: new Date(),
      },
    });
    this.logger.log(`Admin xử lý vụ ${id}: ${decision}`);
    // Xử lý xong khiếu nại: bật lại giám sát nếu admin đã tạm dừng (việc mở vụ phạt mới tự mở lại khi hết khiếu nại)
    await this.prisma.oracleConfig.updateMany({ where: { contractId: vc.contractId, isActive: true, paused: true }, data: { paused: false } });
    this.notifier.fire('RESOLVED', id);
    if (decision === 'UPHOLD') {
      await this.cap.check(vc.contractId).catch((e) => this.logger.error(`Kiểm tra trần phạt lỗi: ${e?.message}`));
    }
    return updated;
  }

  // KIỂM CHỨNG bằng chứng vi phạm: tính lại evidenceHash từ database, đọc bằng chứng trên Polygon và đối chiếu
  async verifyEvidence(id: string) {
    const vc = await this.prisma.violationCase.findUnique({
      where: { id },
      include: { contract: { include: { kpis: true, oracleConfigs: { where: { isActive: true } } } } },
    });
    if (!vc) throw new NotFoundException('Không tìm thấy vụ vi phạm');

    const slaHash = vc.contract.slaHash ?? this.web3.computeSlaHash(vc.contract);
    const recomputedHash = this.web3.computeEvidenceHash({
      contractCode: vc.contract.contractCode,
      slaHash,
      kpiCode: vc.kpiCode,
      targetValue: vc.targetValue,
      actualValue: vc.actualValue,
      detectedAt: vc.createdAt,
    });
    const matchesStored = recomputedHash === vc.evidenceHash;

    let onChain: Awaited<ReturnType<Web3Service['getEvidence']>> | null = null;
    let chainError: string | null = null;
    try {
      onChain = await this.web3.getEvidence(recomputedHash);
    } catch (err: any) {
      chainError = err?.message ?? 'Không đọc được blockchain';
    }

    // Trạng thái DB tương ứng trên chain (UPHELD / DISMISSED là kết quả off-chain của vụ CHALLENGED)
    const expectedChainStatus = ['UPHELD', 'DISMISSED'].includes(vc.status) ? 'CHALLENGED' : vc.status;

    const checks = onChain
      ? {
          hashMatchesDatabase: matchesStored,
          existsOnChain: onChain.status !== 'NONE',
          slaHashMatches: onChain.slaHash.toLowerCase() === slaHash.toLowerCase(),
          creditMatches: onChain.creditBps === vc.creditBps,
          statusMatches: onChain.status === expectedChainStatus,
        }
      : null;
    const ok = !!checks && Object.values(checks).every(Boolean);

    let verdict: string;
    if (chainError) verdict = `KHÔNG KIỂM TRA ĐƯỢC: ${chainError}`;
    else if (!vc.recordTxHash) verdict = 'CHƯA GHI LÊN BLOCKCHAIN (đang chờ hệ thống thử lại)';
    else if (!matchesStored) verdict = 'KHÔNG KHỚP: số liệu vi phạm trong database đã bị thay đổi';
    else if (!ok) verdict = 'KHÔNG KHỚP: dữ liệu trên blockchain khác với database (xem chi tiết từng mục)';
    else verdict = 'KHỚP: bằng chứng vi phạm, mức hoàn phí và trạng thái trùng khớp với blockchain';

    const tx = (h: string | null) => (h ? `https://amoy.polygonscan.com/tx/${h}` : null);
    return {
      ok,
      verdict,
      databaseStatus: vc.status,
      storedHash: vc.evidenceHash,
      recomputedHash,
      onChain,
      checks,
      links: { record: tx(vc.recordTxHash), challenge: tx(vc.challengeTxHash), settle: tx(vc.settleTxHash) },
    };
  }
}
