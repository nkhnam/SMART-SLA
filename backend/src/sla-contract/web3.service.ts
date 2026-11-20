import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ethers } from 'ethers';

// Chỉ khai báo các hàm backend cần gọi (đủ dùng, không cần copy cả file artifacts)
const SLA_ABI = [
  'function registerSLA(bytes32 slaHash)',
  'function slaRegisteredAt(bytes32 slaHash) view returns (uint64)',
  'function recordViolation(bytes32 evidenceHash, bytes32 slaHash, uint32 creditBps, uint64 windowSeconds)',
  'function challenge(bytes32 evidenceHash)',
  'function settle(bytes32 evidenceHash)',
  'function evidences(bytes32) view returns (bytes32 slaHash, uint64 deadline, uint32 creditBps, uint8 status)',
  // Khai báo lỗi của contract để log ra đúng tên lỗi (NotFound, WindowOpen...)
  'error NotOperator()',
  'error AlreadyExists()',
  'error NotFound()',
  'error WrongStatus()',
  'error WindowClosed()',
  'error WindowOpen()',
];

// Cảnh báo khi số dư ví backend dưới ngưỡng này (POL). Mỗi vụ vi phạm tốn khoảng 0.005 POL.
const LOW_BALANCE_POL = Number(process.env.POL_LOW_BALANCE) || 0.02;
// Dưới mức này thì không gửi giao dịch (chắc chắn thất bại), chờ nạp thêm rồi tự thử lại
const MIN_TX_BALANCE_POL = 0.003;
// Chi phí ước tính 1 giao dịch (dùng để ước lượng còn bao nhiêu giao dịch)
const AVG_TX_COST_POL = 0.0025;

@Injectable()
export class Web3Service {
  private readonly logger = new Logger(Web3Service.name);
  private provider: ethers.JsonRpcProvider | null = null;
  private contract: ethers.Contract | null = null;

  // Hàng đợi: gửi từng giao dịch một để không bị trùng nonce
  // (Oracle và cron tự chốt có thể gửi cùng lúc)
  private queue: Promise<unknown> = Promise.resolve();
  private wallet: ethers.Wallet | null = null;
  private lastBalance: { pol: number; checkedAt: string } | null = null;

  constructor() {
    const rpcUrl = process.env.AMOY_RPC_URL;
    const privateKey = process.env.OPERATOR_PRIVATE_KEY;
    const address = process.env.SLA_CONTRACT_ADDRESS;

    if (!rpcUrl || !privateKey || !address) {
      this.logger.warn(
        'Thiếu AMOY_RPC_URL / OPERATOR_PRIVATE_KEY / SLA_CONTRACT_ADDRESS -> KHÔNG ghi lên blockchain',
      );
      return;
    }

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, this.provider);
    this.wallet = wallet;
    this.contract = new ethers.Contract(address, SLA_ABI, wallet);
    this.logger.log(`Đã kết nối SLAContract ${address} trên Polygon Amoy`);
  }

  // HASH (dấu vân tay)

  // Dấu vân tay SLA: chỉ dùng dữ liệu đã lưu trong DB -> ai cũng tính lại được để đối chiếu
  //   hashVersion 1 (hợp đồng cũ): các trường cơ bản
  //   hashVersion 2 (SLA Builder): thêm TOÀN BỘ điều khoản KPI -> sửa bất kỳ điều khoản nào cũng lộ ra
  //   hashVersion 3: thêm điều kiện bổ sung (văn bản hai bên tự thống nhất)
  computeSlaHash(c: any): string {
    const base: any = {
      contractCode: c.contractCode,
      clientId: c.clientId,
      providerId: c.providerId,
      serviceName: c.serviceName,
      uptimeTarget: c.uptimeTarget,
      responseMaxMs: c.responseMaxMs,
      penaltyRule: c.penaltyRule,
      createdAt: new Date(c.createdAt).toISOString(),
    };
    if (c.hashVersion >= 2) {
      base.challengeWindowSeconds = c.challengeWindowSeconds;
      base.kpis = [...(c.kpis ?? [])]
        .sort((a: any, b: any) => a.kpiCode.localeCompare(b.kpiCode))
        .map((k: any) => ({
          kpiCode: k.kpiCode,
          comparator: k.comparator,
          target: k.target,
          dataSource: k.dataSource,
          windowMinutes: k.windowMinutes,
          exclusions: (k.exclusions ?? []).map((e: any) => ({
            dayOfWeek: e.dayOfWeek,
            start: e.start,
            end: e.end,
          })),
          creditTiers: (k.creditTiers ?? []).map((t: any) => ({
            maxBreach: t.maxBreach,
            creditBps: t.creditBps,
          })),
          ...(k.minPercent !== null && k.minPercent !== undefined ? { minPercent: k.minPercent } : {}),
        }));
    }
    // hashVersion 3: thêm điều kiện bổ sung (giữ nguyên thứ tự hai bên đã thống nhất)
    if (c.hashVersion >= 3) {
      base.additionalConditions = [...(c.additionalConditions ?? [])];
    }
    // hashVersion 4: thêm giá trị hợp đồng và thời hạn hiệu lực
    if (c.hashVersion >= 4) {
      base.contractValueVnd = c.contractValueVnd ?? null;
      base.effectiveFrom = c.effectiveFrom ? new Date(c.effectiveFrom).toISOString() : null;
      base.effectiveTo = c.effectiveTo ? new Date(c.effectiveTo).toISOString() : null;
    }
    // hashVersion 5: thêm URL dịch vụ mà SMART-SLA đo (HTTP Health Check) -> đã ký thì không ai đổi lén được
    if (c.hashVersion >= 5) {
      if (!Array.isArray(c.oracleConfigs)) throw new Error('Thiếu cấu hình nguồn dữ liệu để tính hash hợp đồng');
      base.monitoring = {
        httpUrls: c.oracleConfigs
          .filter((o: any) => o.sourceType === 'HTTP_CHECK' && o.isActive !== false)
          .map((o: any) => String(o.endpointUrl))
          .sort(),
      };
    }
    return ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(base)));
  }

  // Dấu vân tay bằng chứng vi phạm (evidence package)
  computeEvidenceHash(e: {
    contractCode: string;
    slaHash: string;
    kpiCode: string;
    targetValue: number;
    actualValue: number;
    detectedAt: Date;
  }): string {
    const payload = JSON.stringify({
      contractCode: e.contractCode,
      slaHash: e.slaHash,
      kpiCode: e.kpiCode,
      targetValue: e.targetValue,
      actualValue: e.actualValue,
      detectedAt: e.detectedAt.toISOString(),
      source: 'ORACLE_HUB',
    });
    return ethers.keccak256(ethers.toUtf8Bytes(payload));
  }

  // GỬI GIAO DỊCH

  // Polygon yêu cầu phí ưu tiên tối thiểu ~25 gwei, đặt 30 gwei cho chắc
  private async feeOverrides() {
    const block = await this.provider!.getBlock('latest');
    const tip = ethers.parseUnits('30', 'gwei');
    const base = block?.baseFeePerGas ?? 0n;
    return { maxPriorityFeePerGas: tip, maxFeePerGas: base * 2n + tip };
  }

  // Gửi 1 giao dịch tới contract, chờ xác nhận, trả về txHash thật (null nếu lỗi, KHÔNG bịa)
  private sendTx(fn: string, args: unknown[]): Promise<string | null> {
    const run = this.queue.then(async () => {
      if (!this.contract) return null;
      // Kiểm tra trước số dư: hết POL thì báo rõ ràng thay vì lỗi khó hiểu "missing revert data"
      const pol = await this.getBalancePol().catch(() => null);
      if (pol !== null && pol < MIN_TX_BALANCE_POL) {
        this.logger.error(
          `[${fn}] KHÔNG GỬI: ví backend chỉ còn ${pol.toFixed(4)} POL (cần >= ${MIN_TX_BALANCE_POL}). Nạp thêm POL, hệ thống sẽ tự thử lại.`,
        );
        return null;
      }
      try {
        const tx = await this.contract[fn](...args, await this.feeOverrides());
        this.logger.log(`[${fn}] đã gửi ${tx.hash}, đang chờ xác nhận...`);
        await tx.wait(1);
        this.logger.log(`[${fn}] thành công`);
        return tx.hash as string;
      } catch (err: any) {
        const reason =
          err?.code === 'INSUFFICIENT_FUNDS'
            ? 'ví backend không đủ POL trả phí gas'
            : (err?.revert?.name ?? err?.shortMessage ?? err?.message);
        this.logger.error(`[${fn}] thất bại: ${reason}`);
        return null;
      }
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  // Đọc on-chain: hash SLA đã được ghi chưa? (hàm view, không tốn phí)
  async isSlaRegistered(slaHash: string): Promise<boolean> {
    if (!this.contract) return false;
    try {
      const ts: bigint = await this.contract.slaRegisteredAt(slaHash);
      return ts > 0n;
    } catch {
      return false;
    }
  }

  // Đọc on-chain: thời điểm hash SLA được ghi (0 = chưa từng ghi)
  async getSlaRegisteredAt(slaHash: string): Promise<number> {
    if (!this.contract) throw new Error('Chưa kết nối blockchain');
    const ts: bigint = await this.contract.slaRegisteredAt(slaHash);
    return Number(ts);
  }

  // Đọc on-chain: bằng chứng vi phạm (status: 0 None, 1 Pending, 2 Challenged, 3 Settled)
  async getEvidence(evidenceHash: string) {
    if (!this.contract) throw new Error('Chưa kết nối blockchain');
    const e = await this.contract.evidences(evidenceHash);
    const names = ['NONE', 'PENDING', 'CHALLENGED', 'SETTLED'];
    return {
      slaHash: e.slaHash as string,
      deadline: Number(e.deadline),
      creditBps: Number(e.creditBps),
      status: names[Number(e.status)] ?? 'UNKNOWN',
    };
  }

  // Số dư POL hiện tại của ví backend
  async getBalancePol(): Promise<number> {
    if (!this.provider || !this.wallet) throw new Error('Chưa kết nối blockchain');
    const wei = await this.provider.getBalance(this.wallet.address);
    const pol = Number(ethers.formatEther(wei));
    this.lastBalance = { pol, checkedAt: new Date().toISOString() };
    return pol;
  }

  // Cron 10 phút: cảnh báo trong log khi ví sắp hết POL
  @Cron(CronExpression.EVERY_10_MINUTES)
  async checkBalance() {
    if (!this.wallet) return;
    try {
      const pol = await this.getBalancePol();
      if (pol < LOW_BALANCE_POL) {
        this.logger.warn(
          `⚠️ VÍ SẮP HẾT POL: còn ${pol.toFixed(4)} POL (~${Math.floor(pol / AVG_TX_COST_POL)} giao dịch). Nạp thêm vào ${this.wallet.address}`,
        );
      }
    } catch (err: any) {
      this.logger.error(`Không đọc được số dư ví: ${err?.message}`);
    }
  }

  // Tình trạng kết nối blockchain + ví (cho trang Admin / kiểm tra trước demo)
  async getStatus() {
    if (!this.wallet || !this.contract) {
      return { connected: false, message: 'Thiếu AMOY_RPC_URL / OPERATOR_PRIVATE_KEY / SLA_CONTRACT_ADDRESS' };
    }
    let pol: number | null = null;
    let error: string | null = null;
    try {
      pol = await this.getBalancePol();
    } catch (err: any) {
      error = err?.message ?? 'Không đọc được số dư';
    }
    return {
      connected: error === null,
      network: 'Polygon Amoy (chainId 80002)',
      contractAddress: this.contractAddress,
      operatorAddress: this.wallet.address,
      balancePol: pol === null ? null : Number(pol.toFixed(5)),
      lowBalance: pol !== null && pol < LOW_BALANCE_POL,
      lowBalanceThresholdPol: LOW_BALANCE_POL,
      estimatedTxRemaining: pol === null ? null : Math.floor(pol / AVG_TX_COST_POL),
      faucet: 'https://ghostchain.io/faucet/polygon-amoy/',
      error,
      links: {
        operator: `https://amoy.polygonscan.com/address/${this.wallet.address}`,
        contract: this.contractAddress ? `https://amoy.polygonscan.com/address/${this.contractAddress}` : null,
      },
    };
  }

  get contractAddress(): string | null {
    return process.env.SLA_CONTRACT_ADDRESS ?? null;
  }

  get isEnabled(): boolean {
    return this.contract !== null;
  }

  // Bước 1: ghi hash hợp đồng SLA
  async registerSla(c: any): Promise<{ slaHash: string; txHash: string | null }> {
    const slaHash = this.computeSlaHash(c);
    const txHash = await this.sendTx('registerSLA', [slaHash]);
    return { slaHash, txHash };
  }

  // Bước 2: ghi bằng chứng vi phạm + mở Challenge Window
  recordViolation(evidenceHash: string, slaHash: string, creditBps: number, windowSeconds: number) {
    return this.sendTx('recordViolation', [evidenceHash, slaHash, creditBps, windowSeconds]);
  }

  // Bước 3a: phản đối trong thời hạn
  challenge(evidenceHash: string) {
    return this.sendTx('challenge', [evidenceHash]);
  }

  // Bước 3b: hết hạn không ai phản đối -> chốt
  settle(evidenceHash: string) {
    return this.sendTx('settle', [evidenceHash]);
  }
}
