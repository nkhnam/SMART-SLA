import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { Web3Service } from './web3.service';
import { OracleService } from './oracle.service';
import { AuthUser } from '../auth/auth.guard';
import { SlaBuilderService } from './sla-builder.service';
import { SigningService } from './signing.service';
import { PlanService } from '../billing/plan.service';
import { normalizeContractTerms, vnDateString } from './contract-terms';

// Bật = hợp đồng mới phải được 2 bên KÝ (EIP-712) rồi mới kích hoạt. Tắt = kích hoạt ngay như trước.
const REQUIRE_SIGNATURES = process.env.REQUIRE_SIGNATURES === 'true';

@Injectable()
export class SlaContractService {
  private readonly logger = new Logger(SlaContractService.name);

  constructor(
    private prisma: PrismaService,
    private web3Service: Web3Service,
    private oracleService: OracleService,
    private builder: SlaBuilderService,
    private signing: SigningService,
    private plans: PlanService,
  ) {}

  async createContract(data: any, user?: AuthUser | null, publicBaseUrl?: string) {
    // Gói dịch vụ: phải có gói còn hiệu lực và còn suất SLA (Pay as you go: tính phí mỗi hợp đồng)
    const planState = user ? await this.plans.requireActive(user.orgId) : null;
    if (user && planState) await this.plans.assertSlaQuota(user.orgId, planState);

    // 0. Dựng + kiểm tra điều khoản KPI (SLA Builder) trước khi ghi bất cứ thứ gì
    const built = this.builder.buildKpis(data);
    const additionalConditions = this.builder.normalizeConditions(data?.additionalConditions);
    const terms = normalizeContractTerms(data);
    const contractName = this.normalizeName(data?.contractName);
    // URL giám sát sai -> báo lỗi ngay, không tạo hợp đồng thiếu nguồn đo
    if (data?.monitorUrl) {
      try {
        data.monitorUrl = await this.oracleService.verifyHttpUrl(data.monitorUrl);
      } catch (err: any) {
        throw new BadRequestException(`URL giám sát: ${err?.message}`);
      }
    }
    const uptimeKpi = built.kpis.find((k) => k.kpiCode === 'UPTIME');
    const responseKpi = built.kpis.find((k) => k.kpiCode === 'RESPONSE_TIME');

    // 1. Xác định 2 bên của hợp đồng
    const me = user
      ? await this.prisma.organization.findUnique({ where: { id: user.orgId }, include: { provider: true } })
      : null;

    // Bên mua: nếu người tạo là BUYER -> chính doanh nghiệp của họ.
    // Nếu người tạo là SUPPLIER -> ưu tiên doanh nghiệp bên mua ĐÃ ĐĂNG KÝ có đúng tên đó (phân biệt hoa thường),
    // không có mới tạo bản giữ chỗ (bên mua đăng ký sau sẽ không tự nhận được hợp đồng này).
    let client;
    if (me && me.orgType === 'BUYER') {
      client = me;
    } else {
      const clientName = String(data.client || '').trim() || 'Default Client';
      const registered = await this.prisma.organization.findMany({
        where: {
          name: clientName, // khớp CHÍNH XÁC, phân biệt chữ hoa / chữ thường
          orgType: 'BUYER',
          users: { some: { isActive: true } },
        },
      });
      if (registered.length > 1) {
        throw new BadRequestException(
          `Có ${registered.length} doanh nghiệp bên mua cùng tên "${clientName}". Vui lòng dùng tên đầy đủ, chính xác hơn.`,
        );
      }
      if (registered.length === 1) {
        client = registered[0];
      } else {
        const clientEmail = `${clientName.toLowerCase().replace(/\s/g, '')}@smartsla.io`;
        client = await this.prisma.organization.upsert({
          where: { email: clientEmail },
          update: {},
          create: { name: clientName, email: clientEmail },
        });
      }
    }

    // Nhà cung cấp: nếu người tạo là SUPPLIER -> chính hồ sơ Provider của họ; ngược lại tạo/lấy theo tên
    let provider;
    if (me && me.orgType === 'SUPPLIER' && me.provider) {
      provider = me.provider;
    } else {
      const providerName = data.provider || 'Amazon Web Services';
      provider = await this.prisma.provider.upsert({
        where: { name: providerName },
        update: {},
        create: { name: providerName, serviceType: data.service || 'Cloud' },
      });
    }

    // 2. Lưu hợp đồng + danh sách KPI vào Database (Chưa có txHash)
    const contractCode = `SLA-${Math.floor(1000 + Math.random() * 9000)}`;
    const created = await this.prisma.slaContract.create({
      data: {
        contractCode: contractCode,
        contractName,
        clientId: client.id,
        providerId: provider.id,
        serviceName: data.service || built.serviceName || 'Dịch vụ số',
        // 2 cột cũ giữ lại để tương thích (hợp đồng không có KPI này thì không bao giờ bị tính vi phạm)
        uptimeTarget: uptimeKpi?.target ?? 0,
        responseMaxMs: Math.round(responseKpi?.target ?? 100000),
        penaltyRule: data.penalty || this.builder.describePenalty(built.kpis),
        challengeWindowSeconds: Math.round(built.challengeWindowHours * 3600),
        templateCode: data.templateCode ?? null,
        hashVersion: 5,
        additionalConditions,
        ...terms,
        status: REQUIRE_SIGNATURES ? 'PENDING_SIGNATURE' : 'ACTIVE',
        kpis: {
          create: built.kpis.map((k) => ({
            ...k,
            exclusions: k.exclusions as any,
            creditTiers: k.creditTiers as any,
          })),
        },
      },
    });

    // URL dịch vụ cần giám sát (HTTP Health Check): thuộc điều khoản hợp đồng (hash từ v5) -> cấu hình trước khi băm hash
    if (data.monitorUrl) {
      try {
        await this.oracleService.setHttpCheck(created.id, data.monitorUrl);
      } catch (err: any) {
        this.logger.warn(`Không cấu hình được Oracle cho ${contractCode}: ${err?.message}`);
      }
    }

    // Đọc lại từ DB (kèm KPI, nguồn đo) để hash đúng như dữ liệu ai cũng đọc lại được
    let contract: any = await this.prisma.slaContract.findUnique({
      where: { id: created.id },
      include: { kpis: true, oracleConfigs: { where: { isActive: true } } },
    });

    // 3-4. Chờ ký: CHƯA ghi lên chain (ghi khi đủ 2 chữ ký). Không cần ký: băm hash và ghi lên Polygon ngay
    if (!REQUIRE_SIGNATURES) {
      const { slaHash, txHash } = await this.web3Service.registerSla(contract);
      contract = await this.prisma.slaContract.update({
        where: { id: contract.id },
        data: { slaHash, txHash },
        include: { kpis: true },
      });
    }

    // Pay as you go: ghi phí khởi tạo hợp đồng này (idempotency theo mã hợp đồng -> không tính 2 lần)
    if (user && planState) {
      await this.plans.chargePerContract(user.orgId, user.userId, contract.id, contract.contractCode, planState);
    }

    // (Tuỳ chọn) Bên tạo hợp đồng tạo luôn địa chỉ webhook của mình. Mã bí mật chỉ trả về 1 lần ở đây.
    let webhookUrl: string | null = null;
    if (data.createWebhook && user && publicBaseUrl) {
      const party = contract.clientId === user.orgId ? 'BUYER' : 'SUPPLIER';
      try {
        webhookUrl = (await this.oracleService.setWebhook(contract.id, publicBaseUrl, party)).webhookUrl;
      } catch (err: any) {
        this.logger.warn(`Không tạo được webhook cho ${contractCode}: ${err?.message}`);
      }
    }

    return { ...contract, webhookUrl };
  }

  // Tên hợp đồng: không bắt buộc, tối đa 120 ký tự
  private normalizeName(raw: unknown): string | null {
    const name = String(raw ?? '').trim().replace(/\s+/g, ' ');
    if (name.length > 120) throw new BadRequestException('Tên hợp đồng tối đa 120 ký tự');
    return name || null;
  }

  // Đổi tên hợp đồng (nhãn quản lý, không thuộc điều khoản đã ký nên đổi được mọi lúc)
  async rename(id: string, raw: unknown) {
    const contractName = this.normalizeName(raw);
    await this.prisma.slaContract.update({ where: { id }, data: { contractName } });
    return this.getContract(id);
  }

  // Thông tin 2 bên trả ra ngoài: chỉ tên (không lộ email, số dư...)
  private partySelect = {
    client: { select: { id: true, name: true, orgType: true } },
    provider: { select: { id: true, name: true, serviceType: true, organizationId: true } },
    // Trạng thái ký (không trả chữ ký / dữ liệu nhạy cảm)
    signatures: { select: { party: true, method: true, signedAt: true, declaredWallet: true } },
  };

  async getAllContracts(where: any = {}) {
    return this.prisma.slaContract.findMany({
      where,
      include: {
        ...this.partySelect,
        kpis: true,
        // KHÔNG trả apiKeySecret (token webhook) ra ngoài
        oracleConfigs: {
          where: { isActive: true },
          select: { id: true, sourceType: true, endpointUrl: true, isActive: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getContract(id: string) {
    const c = await this.prisma.slaContract.findUnique({
      where: { id },
      include: {
        ...this.partySelect,
        kpis: true,
        oracleConfigs: {
          where: { isActive: true },
          select: { id: true, sourceType: true, endpointUrl: true, isActive: true },
        },
      },
    });
    if (!c) throw new NotFoundException('Không tìm thấy hợp đồng');
    return { ...c, contractAddress: this.web3Service.contractAddress };
  }

  // KIỂM CHỨNG: tính lại hash từ dữ liệu trong database, so với hash đã lưu và với dữ liệu trên Polygon.
  // Không cần tin SMART-SLA: ai cũng có thể tự tính lại và tự đọc blockchain để đối chiếu.
  async verifyContract(id: string) {
    const c = await this.prisma.slaContract.findUnique({
      where: { id },
      include: { kpis: true, signatures: true, oracleConfigs: { where: { isActive: true } } },
    });
    if (!c) throw new NotFoundException('Không tìm thấy hợp đồng');

    const recomputedHash = this.web3Service.computeSlaHash(c);
    const matchesStored = c.slaHash ? recomputedHash === c.slaHash : null;

    let registeredAt = 0;
    let chainError: string | null = null;
    try {
      registeredAt = await this.web3Service.getSlaRegisteredAt(recomputedHash);
    } catch (err: any) {
      chainError = err?.message ?? 'Không đọc được blockchain';
    }

    let ok = false;
    let verdict: string;
    if (chainError) {
      verdict = `KHÔNG KIỂM TRA ĐƯỢC: ${chainError}`;
    } else if (!c.slaHash) {
      verdict = 'CHƯA GHI LÊN BLOCKCHAIN (hợp đồng tạo trước khi nối Polygon hoặc ghi thất bại)';
    } else if (!matchesStored) {
      verdict = 'KHÔNG KHỚP: dữ liệu hợp đồng trong database đã bị thay đổi sau khi ghi lên blockchain';
    } else if (registeredAt === 0) {
      verdict = 'KHÔNG TÌM THẤY TRÊN BLOCKCHAIN: hash không tồn tại trong SLAContract';
    } else {
      ok = true;
      verdict = `KHỚP: dữ liệu hợp đồng không bị thay đổi kể từ ${new Date(registeredAt * 1000).toISOString()}`;
    }

    const addr = this.web3Service.contractAddress;
    return {
      contractCode: c.contractCode,
      ok,
      verdict,
      hashVersion: c.hashVersion,
      storedHash: c.slaHash,
      recomputedHash,
      matchesStored,
      onChain: {
        registered: registeredAt > 0,
        registeredAt: registeredAt ? new Date(registeredAt * 1000).toISOString() : null,
      },
      txHash: c.txHash,
      // Chữ ký EIP-712 của 2 bên: tự kiểm lại chữ ký + đúng điều khoản hiện tại
      signatures: this.signing.verifyStoredSignatures(c.signatures, recomputedHash),
      links: {
        transaction: c.txHash ? `https://amoy.polygonscan.com/tx/${c.txHash}` : null,
        contract: addr ? `https://amoy.polygonscan.com/address/${addr}` : null,
      },
    };
  }

  // SỬA ĐIỀU KHOẢN khi hợp đồng còn "Chờ ký": dựng lại KPI, HUỶ mọi chữ ký đã có (chữ ký gắn với nội dung cũ),
  // giữ ví đã khai báo, và ghi 1 tin nhắn vào luồng Bàn bạc để bên kia biết.
  async updateTerms(id: string, data: any, user: AuthUser) {
    const contract = await this.prisma.slaContract.findUnique({ where: { id }, include: { signatures: true } });
    if (!contract) throw new NotFoundException('Không tìm thấy hợp đồng');
    if (contract.status !== 'PENDING_SIGNATURE') {
      throw new BadRequestException('Chỉ sửa được điều khoản khi hợp đồng chưa đủ chữ ký của hai bên');
    }

    const built = this.builder.buildKpis({ ...data, templateCode: undefined });
    // Không gửi additionalConditions -> giữ nguyên điều kiện cũ
    const additionalConditions =
      data?.additionalConditions === undefined ? contract.additionalConditions : this.builder.normalizeConditions(data.additionalConditions);
    const terms = normalizeContractTerms(data, contract);
    const uptimeKpi = built.kpis.find((k) => k.kpiCode === 'UPTIME');
    const responseKpi = built.kpis.find((k) => k.kpiCode === 'RESPONSE_TIME');
    const hadSignatures = contract.signatures.some((s) => s.signature);
    const version = contract.termsVersion + 1;

    await this.prisma.$transaction([
      this.prisma.slaKpi.deleteMany({ where: { contractId: id } }),
      this.prisma.slaContract.update({
        where: { id },
        data: {
          serviceName: String(data?.service ?? '').trim() || contract.serviceName,
          uptimeTarget: uptimeKpi?.target ?? 0,
          responseMaxMs: Math.round(responseKpi?.target ?? 100000),
          penaltyRule: this.builder.describePenalty(built.kpis),
          challengeWindowSeconds: Math.round(built.challengeWindowHours * 3600),
          termsVersion: version,
          hashVersion: 5,
          additionalConditions,
          ...terms,
          termsUpdatedAt: new Date(),
          termsUpdatedById: user.userId,
          kpis: {
            create: built.kpis.map((k) => ({ ...k, exclusions: k.exclusions as any, creditTiers: k.creditTiers as any })),
          },
        },
      }),
      // Huỷ chữ ký + mã OTP đang chờ, giữ ví đã khai báo
      this.prisma.contractSignature.updateMany({
        where: { contractId: id },
        data: {
          method: null,
          signature: null,
          signerAddress: null,
          typedData: Prisma.DbNull,
          signedById: null,
          signedAt: null,
          signerEmail: null,
          otpHash: null,
          otpExpiresAt: null,
          otpAttempts: 0,
        },
      }),
    ]);

    // Ghi vào luồng Bàn bạc (tạo luồng nếu chưa có)
    const party = contract.clientId === user.orgId ? 'BUYER' : 'SUPPLIER';
    const me = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true } });
    const body =
      `[Hệ thống] Điều khoản đã được sửa (phiên bản ${version}).` +
      (hadSignatures ? ' Các chữ ký trước đó đã bị huỷ, hai bên cần ký lại.' : '') +
      `\nĐiều khoản mới: ${this.builder.describePenalty(built.kpis)}. Thời hạn phản đối ${built.challengeWindowHours} giờ.` +
      `\nGiá trị ${terms.contractValueVnd.toLocaleString('vi-VN')} VNĐ/tháng, hiệu lực ${vnDateString(terms.effectiveFrom)} đến ${vnDateString(terms.effectiveTo)}.` +
      `\nĐiều kiện bổ sung: ${additionalConditions.length ? additionalConditions.length + ' điều' : 'không có'}.` +
      (data?.note ? `\nGhi chú: ${String(data.note).slice(0, 500)}` : '');
    let thread = await this.prisma.ticket.findFirst({ where: { contractId: id, kind: 'NEGOTIATION' } });
    if (!thread) {
      thread = await this.prisma.ticket.create({
        data: { contractId: id, kind: 'NEGOTIATION', title: 'Bàn bạc điều khoản', status: 'OPEN', createdById: user.userId, createdByParty: party },
      });
    }
    await this.prisma.ticketMessage.create({
      data: { ticketId: thread.id, authorId: user.userId, authorParty: party, authorName: me?.fullName ?? 'Người dùng', body },
    });
    await this.prisma.ticket.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });

    this.logger.log(`${contract.contractCode}: sửa điều khoản -> phiên bản ${version}${hadSignatures ? ', huỷ chữ ký cũ' : ''}`);
    return this.getContract(id);
  }

  // NGUỒN ĐO LÀ ĐIỀU KHOẢN (hash từ v5): URL HTTP Health Check chỉ thêm / gỡ được khi hợp đồng còn chờ ký.
  // Thay đổi khi đã có bên ký -> huỷ chữ ký (chữ ký gắn với nội dung cũ), tăng phiên bản điều khoản, báo vào luồng Bàn bạc.
  async changeHttpSource(id: string, user: AuthUser, change: { add?: string; removeId?: string }) {
    const contract = await this.prisma.slaContract.findUnique({ where: { id }, include: { signatures: true } });
    if (!contract) throw new NotFoundException('Không tìm thấy hợp đồng');
    if (contract.status !== 'PENDING_SIGNATURE') {
      throw new BadRequestException('URL giám sát là điều khoản đã ký và đã ghi lên blockchain, không sửa được nữa');
    }
    let label: string;
    if (change.add !== undefined) {
      try {
        change.add = await this.oracleService.verifyHttpUrl(change.add);
      } catch (err: any) {
        throw new BadRequestException(err?.message);
      }
      const cfg = await this.oracleService.setHttpCheck(id, change.add);
      label = `thêm URL giám sát ${cfg.endpointUrl}`;
    } else {
      const cfg = await this.prisma.oracleConfig.findFirst({ where: { id: change.removeId, contractId: id, isActive: true, sourceType: 'HTTP_CHECK' } });
      if (!cfg) throw new BadRequestException('Không tìm thấy URL giám sát');
      await this.oracleService.removeSource(id, cfg.id);
      label = `gỡ URL giám sát ${cfg.endpointUrl}`;
    }

    const hadSignatures = contract.signatures.some((s) => s.signature);
    const version = contract.termsVersion + 1;
    await this.prisma.$transaction([
      this.prisma.slaContract.update({
        where: { id },
        data: { termsVersion: version, hashVersion: 5, termsUpdatedAt: new Date(), termsUpdatedById: user.userId },
      }),
      ...(hadSignatures ? [this.clearSignatures(id)] : []),
    ]);
    await this.postSystemMessage(
      id,
      user,
      `[Hệ thống] Nguồn giám sát đã thay đổi (phiên bản ${version}): ${label}.` + (hadSignatures ? ' Các chữ ký trước đó đã bị huỷ, hai bên cần ký lại.' : ''),
    );
    this.logger.log(`${contract.contractCode}: ${label} -> phiên bản ${version}${hadSignatures ? ', huỷ chữ ký cũ' : ''}`);
    return { ok: true, termsVersion: version, signaturesReset: hadSignatures };
  }

  // Huỷ chữ ký + mã OTP đang chờ, giữ ví đã khai báo
  private clearSignatures(contractId: string) {
    return this.prisma.contractSignature.updateMany({
      where: { contractId },
      data: {
        method: null,
        signature: null,
        signerAddress: null,
        typedData: Prisma.DbNull,
        signedById: null,
        signedAt: null,
        signerEmail: null,
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
      },
    });
  }

  // Ghi 1 tin nhắn hệ thống vào luồng Bàn bạc (tạo luồng nếu chưa có)
  private async postSystemMessage(contractId: string, user: AuthUser, body: string) {
    const contract = await this.prisma.slaContract.findUnique({ where: { id: contractId }, select: { clientId: true } });
    const party = contract?.clientId === user.orgId ? 'BUYER' : 'SUPPLIER';
    const me = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { fullName: true } });
    let thread = await this.prisma.ticket.findFirst({ where: { contractId, kind: 'NEGOTIATION' } });
    if (!thread) {
      thread = await this.prisma.ticket.create({
        data: { contractId, kind: 'NEGOTIATION', title: 'Bàn bạc điều khoản', status: 'OPEN', createdById: user.userId, createdByParty: party },
      });
    }
    await this.prisma.ticketMessage.create({
      data: { ticketId: thread.id, authorId: user.userId, authorParty: party, authorName: me?.fullName ?? 'Người dùng', body },
    });
    await this.prisma.ticket.update({ where: { id: thread.id }, data: { updatedAt: new Date() } });
  }
}
