import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PlanService } from '../billing/plan.service';
import { ethers } from 'ethers';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { Web3Service } from './web3.service';
import { ContractAccessService, Party } from './contract-access.service';
import { AuthUser } from '../auth/auth.guard';
import { NotificationService } from './notification.service';

// CHỮ KÝ ĐIỆN TỬ EIP-712 (ECDSA secp256k1)
// Luồng: mỗi bên KHAI BÁO VÍ người ký -> KÝ bằng đúng ví đó (miễn phí, không tốn gas)
//        -> đủ 2 chữ ký -> backend ghi hash hợp đồng lên Polygon (ví hệ thống trả gas) -> ACTIVE
// Dùng được với mọi ví EVM hỗ trợ eth_signTypedData_v4 (MetaMask, Trust, Coinbase, OKX, Rabby, Ledger...)
const CHAIN_ID = 80002; // Polygon Amoy
const SIGN_TTL_SECONDS = 15 * 60; // Nội dung ký có hiệu lực 15 phút kể từ lúc lấy

// OTP email (cho khách KHÔNG có ví)
const OTP_TTL_MS = 10 * 60_000; // mã hiệu lực 10 phút
const OTP_RESEND_MS = 60_000; // 60 giây mới được gửi lại
const OTP_MAX_ATTEMPTS = 5; // nhập sai 5 lần -> phải yêu cầu mã mới
const OTP_SECRET = process.env.JWT_SECRET || 'sla-dex-otp';
// Hash biên bản OTP theo THỨ TỰ TRƯỜNG CỐ ĐỊNH (Postgres JSON có thể đảo thứ tự key khi lưu)
const OTP_EVIDENCE_KEYS = ['contractCode', 'slaHash', 'party', 'organization', 'signerUserId', 'signerEmail', 'statement', 'method', 'signedAt'];
const otpEvidenceHash = (e: any) =>
  ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(OTP_EVIDENCE_KEYS.map((k) => [k, e?.[k] ?? null]))));
const hashOtp = (code: string, key: string) => createHmac('sha256', OTP_SECRET).update(`${key}:${code}`).digest('hex');

export const SLA_TYPES = {
  SlaAgreement: [
    { name: 'contractCode', type: 'string' },
    { name: 'slaHash', type: 'bytes32' },
    { name: 'party', type: 'string' },
    { name: 'organization', type: 'string' },
    { name: 'signer', type: 'address' },
    { name: 'statement', type: 'string' },
    { name: 'issuedAt', type: 'uint256' },
  ],
};

const PARTY_VN: Record<Party, string> = { BUYER: 'Bên mua dịch vụ', SUPPLIER: 'Nhà cung cấp dịch vụ' };

@Injectable()
export class SigningService {
  private readonly logger = new Logger(SigningService.name);

  constructor(
    private prisma: PrismaService,
    private web3: Web3Service,
    private access: ContractAccessService,
    private notifier: NotificationService,
    private plans: PlanService,
  ) {}

  // Domain EIP-712: gắn chữ ký với SLA_DEX + mạng Amoy + đúng smart contract -> không dùng lại được ở nơi khác
  domain() {
    return {
      name: 'SLA_DEX',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: this.web3.contractAddress ?? ethers.ZeroAddress,
    };
  }

  private async loadContract(contractId: string) {
    const c = await this.prisma.slaContract.findUnique({
      where: { id: contractId },
      include: { kpis: true, client: true, provider: true, signatures: true, oracleConfigs: { where: { isActive: true } } },
    });
    if (!c) throw new NotFoundException('Không tìm thấy hợp đồng');
    return c;
  }

  private orgNameOf(c: any, party: Party) {
    return party === 'BUYER' ? c.client.name : c.provider.name;
  }

  // Nội dung ký: "minh bạch nội dung" - ví hiển thị từng trường cho người ký đọc trước khi bấm Ký
  private buildMessage(c: any, party: Party, signer: string, issuedAt: number) {
    const organization = this.orgNameOf(c, party);
    return {
      contractCode: c.contractCode,
      slaHash: this.web3.computeSlaHash(c), // "toàn vẹn": sửa bất kỳ điều khoản nào -> chữ ký không còn khớp
      party,
      organization,
      signer,
      statement: `Tôi đại diện ${organization} (${PARTY_VN[party]}) xác nhận đã đọc và đồng ý toàn bộ điều khoản của hợp đồng SLA ${c.contractCode}.`,
      issuedAt, // "dấu thời gian" phía người ký (kèm thời điểm ghi lên Polygon)
    };
  }

  // Trạng thái ký của cả 2 bên (+ nội dung cần ký nếu người xem là 1 bên chưa ký)
  async getStatus(contractId: string, user: AuthUser) {
    const party = await this.access.assertParty(contractId, user.orgId);
    const c = await this.loadContract(contractId);

    const sideOf = (p: Party) => {
      const s = c.signatures.find((x) => x.party === p);
      return {
        party: p,
        organization: this.orgNameOf(c, p),
        declaredWallet: s?.declaredWallet ?? null,
        signed: !!s?.signature,
        signerAddress: s?.signerAddress ?? null,
        signedAt: s?.signedAt ?? null,
        method: s?.method ?? null,
      };
    };

    const mine = c.signatures.find((x) => x.party === party);
    let toSign: any = null;
    if (c.status === 'PENDING_SIGNATURE' && mine?.declaredWallet && !mine.signature) {
      toSign = {
        domain: this.domain(),
        types: SLA_TYPES,
        primaryType: 'SlaAgreement',
        message: this.buildMessage(c, party, mine.declaredWallet, Math.floor(Date.now() / 1000)),
      };
    }

    return {
      contractCode: c.contractCode,
      status: c.status,
      signingRequired: c.status === 'PENDING_SIGNATURE' || c.signatures.length > 0,
      myParty: party,
      parties: [sideOf('BUYER'), sideOf('SUPPLIER')],
      toSign, // frontend: signer.signTypedData(toSign.domain, toSign.types, toSign.message)
      otpAvailable: this.notifier.canSendDirectEmail, // có thể ký bằng mã OTP email (không cần ví)
    };
  }

  // Bước 1: khai báo ví người ký (kết nối ví hoặc gõ tay địa chỉ)
  async declareWallet(contractId: string, user: AuthUser, walletAddress: string) {
    const planState = await this.plans.requireActive(user.orgId);
    await this.plans.assertSlaQuota(user.orgId, planState, 0);
    const party = await this.access.assertParty(contractId, user.orgId);
    const c = await this.loadContract(contractId);
    if (c.status !== 'PENDING_SIGNATURE') throw new BadRequestException('Hợp đồng không ở trạng thái chờ ký');

    if (!walletAddress || !ethers.isAddress(String(walletAddress).trim())) {
      throw new BadRequestException('Địa chỉ ví không hợp lệ (cần địa chỉ EVM dạng 0x... 40 ký tự hex)');
    }
    const wallet = ethers.getAddress(String(walletAddress).trim()); // chuẩn hoá chữ hoa/thường (checksum)

    const existing = c.signatures.find((x) => x.party === party);
    if (existing?.signature) throw new ConflictException('Bên này đã ký, không đổi được ví');

    await this.prisma.contractSignature.upsert({
      where: { contractId_party: { contractId, party } },
      update: { declaredWallet: wallet, declaredById: user.userId, declaredAt: new Date() },
      create: {
        contractId,
        party,
        organizationId: user.orgId,
        declaredWallet: wallet,
        declaredById: user.userId,
        declaredAt: new Date(),
      },
    });
    this.logger.log(`${c.contractCode}: ${party} khai báo ví ${wallet}`);
    return this.getStatus(contractId, user);
  }

  // Bước 2: nhận chữ ký từ ví -> xác minh -> lưu -> đủ 2 bên thì kích hoạt hợp đồng
  async submitSignature(
    contractId: string,
    user: AuthUser,
    body: { signature: string; issuedAt: number },
    meta: { ip?: string; userAgent?: string },
  ) {
    const planState = await this.plans.requireActive(user.orgId);
    await this.plans.assertSlaQuota(user.orgId, planState, 0);
    const party = await this.access.assertParty(contractId, user.orgId);
    const c = await this.loadContract(contractId);
    if (c.status !== 'PENDING_SIGNATURE') throw new BadRequestException('Hợp đồng không ở trạng thái chờ ký');

    const mine = c.signatures.find((x) => x.party === party);
    if (!mine?.declaredWallet) throw new BadRequestException('Cần khai báo ví người ký trước');
    if (mine.signature) throw new ConflictException('Bên này đã ký rồi');

    const issuedAt = Number(body?.issuedAt);
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isInteger(issuedAt) || issuedAt > now + 60 || now - issuedAt > SIGN_TTL_SECONDS) {
      throw new BadRequestException('Nội dung ký đã hết hạn (15 phút), vui lòng lấy lại và ký lại');
    }
    if (!/^0x[0-9a-fA-F]{130}$/.test(String(body?.signature ?? ''))) {
      throw new BadRequestException('Chữ ký không đúng định dạng');
    }

    // Backend TỰ dựng lại nội dung từ database (không tin nội dung client gửi) rồi khôi phục địa chỉ ví đã ký
    const message = this.buildMessage(c, party, mine.declaredWallet, issuedAt);
    let recovered: string;
    try {
      recovered = ethers.verifyTypedData(this.domain(), SLA_TYPES, message, body.signature);
    } catch {
      throw new BadRequestException('Không xác minh được chữ ký');
    }
    // "Xác định danh tính": chữ ký phải đến từ ĐÚNG ví đã khai báo
    if (recovered.toLowerCase() !== mine.declaredWallet.toLowerCase()) {
      throw new BadRequestException(
        `Chữ ký không khớp ví đã khai báo ${mine.declaredWallet}. Có thể bạn ký bằng ví khác, hoặc điều khoản vừa được sửa: hãy tải lại trang rồi ký lại.`,
      );
    }

    await this.prisma.contractSignature.update({
      where: { id: mine.id },
      data: {
        method: 'EIP712',
        signature: body.signature,
        signerAddress: recovered,
        typedData: { domain: this.domain(), types: SLA_TYPES, primaryType: 'SlaAgreement', message } as any,
        signedById: user.userId,
        signedAt: new Date(issuedAt * 1000),
        ip: meta.ip?.slice(0, 64) ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
      },
    });
    this.logger.log(`${c.contractCode}: ${party} đã ký bằng ví ${recovered}`);

    await this.activateIfFullySigned(contractId);
    return this.getStatus(contractId, user);
  }

  // KÝ BẰNG OTP EMAIL (khách không có ví)
  // Bước 1: gửi mã 6 số tới email của chính người đang đăng nhập
  async requestOtp(contractId: string, user: AuthUser) {
    const planState = await this.plans.requireActive(user.orgId);
    await this.plans.assertSlaQuota(user.orgId, planState, 0);
    const party = await this.access.assertParty(contractId, user.orgId);
    const c = await this.loadContract(contractId);
    if (c.status !== 'PENDING_SIGNATURE') throw new BadRequestException('Hợp đồng không ở trạng thái chờ ký');
    if (!this.notifier.canSendDirectEmail) throw new BadRequestException('Hệ thống chưa cấu hình gửi email OTP');

    const mine = c.signatures.find((x) => x.party === party);
    if (mine?.signature) throw new ConflictException('Bên này đã ký rồi');
    if (mine?.otpSentAt && Date.now() - mine.otpSentAt.getTime() < OTP_RESEND_MS) {
      throw new BadRequestException('Vui lòng chờ 60 giây trước khi gửi lại mã');
    }

    const me = await this.prisma.user.findUnique({ where: { id: user.userId } });
    if (!me?.isActive) throw new BadRequestException('Tài khoản không hợp lệ');

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const key = `${contractId}:${party}:${user.userId}`;
    const data = {
      otpHash: hashOtp(code, key), // chỉ lưu bản băm, không lưu mã gốc
      otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
      otpAttempts: 0,
      otpSentAt: new Date(),
      otpUserId: user.userId,
    };
    await this.prisma.contractSignature.upsert({
      where: { contractId_party: { contractId, party } },
      update: data,
      create: { contractId, party, organizationId: user.orgId, ...data },
    });

    const organization = this.orgNameOf(c, party);
    const slaHash = this.web3.computeSlaHash(c);
    await this.notifier.sendDirectEmail(
      me.email,
      `[SLA-DEX] Mã xác nhận ký hợp đồng ${c.contractCode}: ${code}`,
      [
        `Xin chào ${me.fullName},`,
        ``,
        `Mã xác nhận ký hợp đồng ${c.contractCode} của bạn là: ${code}`,
        `Mã có hiệu lực 10 phút. Không chia sẻ mã này cho bất kỳ ai.`,
        ``,
        `Khi nhập mã, bạn xác nhận: "Tôi đại diện ${organization} (${PARTY_VN[party]}) đã đọc và đồng ý toàn bộ điều khoản của hợp đồng SLA ${c.contractCode}."`,
        `Mã định danh điều khoản (slaHash): ${slaHash}`,
        ``,
        `Nếu bạn không yêu cầu mã này, hãy bỏ qua email.`,
        `SLA-DEX`,
      ].join('\n'),
    );
    this.logger.log(`${c.contractCode}: gửi OTP ký cho ${party}`);
    return { sent: true, email: me.email.replace(/^(.{2}).*(@.*)$/, '$1***$2'), expiresInSeconds: OTP_TTL_MS / 1000 };
  }

  // Bước 2: nhập mã -> ghi nhận chữ ký điện tử bằng tài khoản + bằng chứng
  async verifyOtp(contractId: string, user: AuthUser, code: string, meta: { ip?: string; userAgent?: string }) {
    const planState = await this.plans.requireActive(user.orgId);
    await this.plans.assertSlaQuota(user.orgId, planState, 0);
    const party = await this.access.assertParty(contractId, user.orgId);
    const c = await this.loadContract(contractId);
    if (c.status !== 'PENDING_SIGNATURE') throw new BadRequestException('Hợp đồng không ở trạng thái chờ ký');

    const mine = c.signatures.find((x) => x.party === party);
    if (mine?.signature) throw new ConflictException('Bên này đã ký rồi');
    if (!mine?.otpHash || !mine.otpExpiresAt || mine.otpUserId !== user.userId) {
      throw new BadRequestException('Chưa yêu cầu mã OTP');
    }
    if (mine.otpExpiresAt < new Date()) throw new BadRequestException('Mã đã hết hạn, vui lòng yêu cầu mã mới');
    if (mine.otpAttempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('Nhập sai quá nhiều lần, vui lòng yêu cầu mã mới');
    }

    const key = `${contractId}:${party}:${user.userId}`;
    const ok =
      /^\d{6}$/.test(String(code ?? '')) &&
      timingSafeEqual(Buffer.from(hashOtp(String(code), key)), Buffer.from(mine.otpHash));
    if (!ok) {
      await this.prisma.contractSignature.update({ where: { id: mine.id }, data: { otpAttempts: { increment: 1 } } });
      throw new BadRequestException(`Mã không đúng (còn ${OTP_MAX_ATTEMPTS - mine.otpAttempts - 1} lần thử)`);
    }

    const me = await this.prisma.user.findUnique({ where: { id: user.userId } });
    const signedAt = new Date();
    const organization = this.orgNameOf(c, party);
    // Biên bản xác nhận: nội dung đồng ý + danh tính + thời điểm. Hash của biên bản lưu làm "chữ ký".
    const evidence = {
      contractCode: c.contractCode,
      slaHash: this.web3.computeSlaHash(c),
      party,
      organization,
      signerUserId: user.userId,
      signerEmail: me!.email,
      statement: `Tôi đại diện ${organization} (${PARTY_VN[party]}) xác nhận đã đọc và đồng ý toàn bộ điều khoản của hợp đồng SLA ${c.contractCode}.`,
      method: 'OTP_EMAIL',
      signedAt: signedAt.toISOString(),
    };
    const evidenceHash = otpEvidenceHash(evidence);

    await this.prisma.contractSignature.update({
      where: { id: mine.id },
      data: {
        method: 'OTP_EMAIL',
        signature: evidenceHash,
        typedData: evidence as any,
        signerEmail: me!.email,
        signedById: user.userId,
        signedAt,
        ip: meta.ip?.slice(0, 64) ?? null,
        userAgent: meta.userAgent?.slice(0, 300) ?? null,
        otpHash: null, // mã dùng 1 lần
        otpExpiresAt: null,
      },
    });
    this.logger.log(`${c.contractCode}: ${party} đã ký bằng OTP email`);

    await this.activateIfFullySigned(contractId);
    return this.getStatus(contractId, user);
  }

  // Đủ chữ ký 2 bên -> ghi hash hợp đồng lên Polygon -> ACTIVE (bắt đầu giám sát)
  private async activateIfFullySigned(contractId: string) {
    const c = await this.loadContract(contractId);
    const signed = c.signatures.filter((s) => s.signature).map((s) => s.party);
    if (!(signed.includes('BUYER') && signed.includes('SUPPLIER'))) return;

    const { slaHash, txHash } = await this.web3.registerSla(c);
    await this.prisma.slaContract.update({
      where: { id: contractId },
      // txHash null (VD: hết POL) -> vẫn ACTIVE; hệ thống tự ghi bù khi có vi phạm đầu tiên
      data: { status: 'ACTIVE', slaHash, txHash },
    });
    this.logger.log(`${c.contractCode}: đủ 2 chữ ký -> ACTIVE${txHash ? `, tx ${txHash}` : ' (chưa ghi được lên chain)'}`);
  }

  // Kiểm chứng lại chữ ký đã lưu (dùng cho API verify công khai): ai cũng tự làm được bằng ethers.verifyTypedData
  verifyStoredSignatures(signatures: any[], currentSlaHash: string) {
    return signatures
      .filter((s) => s.signature && s.typedData)
      .map((s) => {
        const td = s.typedData as any;
        let signatureValid = false;
        let signedSlaHash = '';
        if (s.method === 'OTP_EMAIL') {
          // OTP: tính lại hash của biên bản xác nhận
          signatureValid = otpEvidenceHash(td) === s.signature;
          signedSlaHash = String(td.slaHash);
        } else {
          // EIP-712: khôi phục địa chỉ ví từ chữ ký
          try {
            const recovered = ethers.verifyTypedData(td.domain, td.types, td.message, s.signature);
            signatureValid = recovered.toLowerCase() === String(s.signerAddress).toLowerCase();
          } catch {
            signatureValid = false;
          }
          signedSlaHash = String(td.message?.slaHash);
        }
        return {
          party: s.party,
          method: s.method,
          signer: s.method === 'OTP_EMAIL' ? s.signerEmail?.replace(/^(.{2}).*(@.*)$/, '$1***$2') : s.signerAddress,
          signedAt: s.signedAt,
          signatureValid,
          signedCurrentTerms: signedSlaHash.toLowerCase() === currentSlaHash.toLowerCase(),
        };
      });
  }
}
