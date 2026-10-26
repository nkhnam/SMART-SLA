import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OracleService } from './oracle.service';
import { Web3Service } from './web3.service';
import { PenaltyCapService } from './penalty-cap.service';
import { CreditTier } from './kpi-catalog';
import { creditAmountVnd, effectiveEndMs, severityForCredit, severityOf, sortTiers, termState, vnDateString } from './contract-terms';

// BÁO CÁO ĐỐI SOÁT theo từng kỳ
//   Kỳ đối soát = kỳ đo KPI (mặc định 30 ngày), tính từ ngày hiệu lực.
//   Demo: ORACLE_DEMO_WINDOW_MINUTES=N -> mỗi kỳ N phút.
// Mỗi kỳ: KPI cam kết vs đo được, các vụ vi phạm, mức phạt, số tiền hoàn phí, số tiền thanh toán sau khấu trừ.
const DEMO_WINDOW_MINUTES = Number(process.env.ORACLE_DEMO_WINDOW_MINUTES) || 0;
const MAX_PERIODS = 24;

const KPI_NAME: Record<string, string> = {
  UPTIME: 'Uptime',
  RESPONSE_TIME: 'Thời gian phản hồi hệ thống',
  FIRST_RESPONSE: 'Tỷ lệ ticket phản hồi đúng hạn',
  RESOLUTION_TIME: 'Tỷ lệ ticket xử lý đúng hạn',
  INCIDENT_RESPONSE: 'Ứng phó sự cố',
};

// Kết quả cuối của 1 vụ: APPLIED = đã chốt, khấu trừ | PROVISIONAL = đang trong hạn phản đối / chờ xử lý | DISMISSED = huỷ
const OUTCOME: Record<string, 'APPLIED' | 'PROVISIONAL' | 'DISMISSED'> = {
  SETTLED: 'APPLIED',
  UPHELD: 'APPLIED',
  PENDING: 'PROVISIONAL',
  CHALLENGED: 'PROVISIONAL',
  DISMISSED: 'DISMISSED',
};

@Injectable()
export class ReconciliationService {
  constructor(
    private prisma: PrismaService,
    private oracle: OracleService,
    private web3: Web3Service,
    private cap: PenaltyCapService,
  ) {}

  async report(contractId: string, periodParam?: string) {
    const c = await this.prisma.slaContract.findUnique({
      where: { id: contractId },
      include: {
        kpis: true,
        client: { select: { id: true, name: true } },
        provider: { select: { id: true, name: true, serviceType: true, reputation: true, organizationId: true } },
        signatures: true,
      },
    });
    if (!c) throw new NotFoundException('Không tìm thấy hợp đồng');
    // Trần phạt 8% tổng giá trị hợp đồng (null: hợp đồng cũ chưa có giá trị / thời hạn)
    const penaltyCap = await this.cap.compute(c.id);

    // Kỳ đối soát
    const cycleMinutes = DEMO_WINDOW_MINUTES || Math.min(...c.kpis.map((k) => k.windowMinutes), 43_200);
    const cycleMs = cycleMinutes * 60_000;
    const anchor = (c.effectiveFrom ?? c.createdAt).getTime();
    const hardEnd = effectiveEndMs(c.effectiveTo) ?? Infinity;
    const now = Date.now();
    const lastEdge = Math.min(now, hardEnd);
    const count = lastEdge <= anchor ? 0 : Math.ceil((lastEdge - anchor) / cycleMs);
    const firstIndex = Math.max(0, count - MAX_PERIODS);
    const periods = [] as { index: number; from: string; to: string; current: boolean }[];
    for (let i = count - 1; i >= firstIndex; i--) {
      const from = anchor + i * cycleMs;
      const to = Math.min(from + cycleMs, hardEnd);
      periods.push({ index: i, from: new Date(from).toISOString(), to: new Date(to).toISOString(), current: now < to });
    }
    const wanted = periodParam !== undefined && periodParam !== '' ? Number(periodParam) : periods[0]?.index;
    const period = periods.find((p) => p.index === wanted) ?? periods[0] ?? null;

    // Người đại diện + chữ ký của mỗi bên
    const signerIds = c.signatures.map((s) => s.signedById).filter(Boolean) as string[];
    const signers = signerIds.length
      ? await this.prisma.user.findMany({ where: { id: { in: signerIds } }, select: { id: true, fullName: true, jobTitle: true } })
      : [];
    const orgAdmins = await this.prisma.user.findMany({
      where: { organizationId: { in: [c.clientId, c.provider.organizationId].filter(Boolean) as string[] }, role: 'ADMIN', isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { organizationId: true, fullName: true, jobTitle: true },
    });
    const partyInfo = (party: 'BUYER' | 'SUPPLIER', orgId: string | null) => {
      const sig = c.signatures.find((s) => s.party === party);
      const signer = signers.find((u) => u.id === sig?.signedById);
      const fallback = orgAdmins.find((u) => u.organizationId === orgId);
      const rep = signer ?? fallback ?? null;
      return {
        representative: rep ? { fullName: rep.fullName, jobTitle: rep.jobTitle ?? null } : null,
        signature: sig?.signedAt
          ? { method: sig.method, signedAt: sig.signedAt, wallet: sig.signerAddress ?? sig.declaredWallet ?? null, email: sig.signerEmail ?? null }
          : null,
      };
    };

    // Điều khoản KPI + nhãn mức phạt
    const terms = c.kpis.map((k) => {
      const tiers = sortTiers((k.creditTiers as unknown as CreditTier[]) ?? []);
      return {
        kpiCode: k.kpiCode,
        name: k.name,
        unit: k.unit,
        comparator: k.comparator,
        target: k.target,
        minPercent: k.minPercent,
        dataSource: k.dataSource,
        tiers: tiers.map((t, i) => ({ ...t, severity: severityOf(i, tiers.length), creditVnd: creditAmountVnd(c.contractValueVnd, t.creditBps) })),
      };
    });

    // Số đo + vi phạm trong kỳ
    let measurements: any[] = [];
    let violations: any[] = [];
    if (period) {
      const from = new Date(period.from);
      const to = new Date(period.to);
      const summary = await this.oracle.getKpiSummary(c.id, { from, to });
      const cases = await this.prisma.violationCase.findMany({
        where: { contractId: c.id, createdAt: { gte: from, lt: to } },
        orderBy: { createdAt: 'asc' },
      });
      violations = cases.map((v) => {
        const kpi = c.kpis.find((k) => k.kpiCode === v.kpiCode);
        const tiers = (kpi?.creditTiers as unknown as CreditTier[]) ?? [];
        const outcome = OUTCOME[v.status] ?? 'PROVISIONAL';
        const rawVnd = creditAmountVnd(c.contractValueVnd, v.creditBps);
        // Vụ đã chốt: số tiền thực áp sau khi xét trần 8% (có thể thấp hơn mức của bậc)
        const fresh = penaltyCap ? cases.find((x) => x.id === v.id) : null;
        return {
          id: v.id,
          kpiCode: v.kpiCode,
          kpiName: kpi?.name ?? KPI_NAME[v.kpiCode] ?? v.kpiCode,
          unit: kpi && kpi.minPercent !== null ? '%' : kpi?.unit ?? '',
          targetValue: v.targetValue,
          actualValue: v.actualValue,
          severity: severityForCredit(tiers, v.creditBps),
          creditBps: v.creditBps,
          creditVnd: outcome === 'APPLIED' && fresh?.creditVndApplied !== null && fresh?.creditVndApplied !== undefined ? fresh.creditVndApplied : rawVnd,
          cappedByLimit: outcome === 'APPLIED' && rawVnd !== null && fresh?.creditVndApplied !== null && fresh?.creditVndApplied !== undefined && fresh.creditVndApplied < rawVnd,
          status: v.status,
          outcome,
          detectedAt: v.createdAt,
          challengeDeadline: v.challengeDeadline,
          challengedBy: v.challengedBy,
          challengeReason: v.challengeReason,
          resolutionNote: v.resolutionNote,
          evidenceHash: v.evidenceHash,
          recordTxHash: v.recordTxHash,
          settleTxHash: v.settleTxHash,
        };
      });
      measurements = summary.kpis.map((m) => {
        const hit = violations.find((v) => v.kpiCode === m.kpiCode && v.outcome !== 'DISMISSED');
        return {
          ...m,
          // Kết luận của kỳ: có vụ vi phạm (chưa bị huỷ) -> VI PHẠM; đủ dữ liệu và đạt -> ĐẠT; còn lại -> chưa đủ dữ liệu
          verdict: hit || m.breached ? 'BREACHED' : m.ready && m.actual !== null ? 'MET' : 'NO_DATA',
        };
      });
    }

    // Tổng hợp tiền
    const sumBps = (o: string) => violations.filter((v) => v.outcome === o).reduce((a, v) => a + v.creditBps, 0);
    const sumVnd = (o: string) => violations.filter((v) => v.outcome === o).reduce((a, v) => a + (v.creditVnd ?? 0), 0);
    const appliedBps = Math.min(10_000, sumBps('APPLIED'));
    const provisionalBps = Math.min(10_000 - appliedBps, sumBps('PROVISIONAL'));
    const value = c.contractValueVnd ?? null;
    const appliedVnd = value === null ? null : Math.min(value, sumVnd('APPLIED'));
    // Phần tạm tính không vượt quá phần còn lại của trần 8%
    const capLeft = penaltyCap ? Math.max(0, penaltyCap.capVnd - penaltyCap.appliedVnd) : Infinity;
    const provisionalVnd = value === null ? null : Math.min(value - (appliedVnd ?? 0), sumVnd('PROVISIONAL'), capLeft);
    const totals = {
      contractValueVnd: value,
      violations: violations.length,
      appliedBps,
      appliedVnd,
      provisionalBps,
      provisionalVnd,
      // Số tiền bên mua thanh toán kỳ này = giá trị - hoàn phí đã chốt (tạm tính: trừ cả phần đang chờ)
      payableVnd: value !== null ? value - (appliedVnd ?? 0) : null,
      payableIfUpheldVnd: value !== null ? value - (appliedVnd ?? 0) - (provisionalVnd ?? 0) : null,
    };

    const addr = this.web3.contractAddress;
    return {
      generatedAt: new Date().toISOString(),
      contract: {
        id: c.id,
        contractCode: c.contractCode,
        contractName: c.contractName,
        serviceName: c.serviceName,
        status: c.status,
        templateCode: c.templateCode,
        contractValueVnd: value,
        effectiveFrom: vnDateString(c.effectiveFrom),
        effectiveTo: vnDateString(c.effectiveTo),
        termState: termState(c),
        challengeWindowHours: Math.round(c.challengeWindowSeconds / 3600),
        additionalConditions: c.additionalConditions,
        hashVersion: c.hashVersion,
        slaHash: c.slaHash,
        txHash: c.txHash,
        createdAt: c.createdAt,
      },
      chain: {
        network: 'Polygon Amoy',
        contractAddress: addr,
        contractLink: addr ? `https://amoy.polygonscan.com/address/${addr}` : null,
        txLink: c.txHash ? `https://amoy.polygonscan.com/tx/${c.txHash}` : null,
      },
      parties: {
        buyer: { name: c.client.name, ...partyInfo('BUYER', c.clientId) },
        supplier: {
          name: c.provider.name,
          serviceType: c.provider.serviceType,
          reputation: c.provider.reputation,
          ...partyInfo('SUPPLIER', c.provider.organizationId),
        },
      },
      cycle: { minutes: cycleMinutes, demo: !!DEMO_WINDOW_MINUTES },
      penaltyCap,
      terms,
      periods,
      period,
      measurements,
      violations,
      totals,
    };
  }
}
