import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, HttpException, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SlaContractService } from './sla-contract.service';
import { OracleService } from './oracle.service';
import { TerminationAlertService } from './termination-alert.service';
import { ReconciliationService } from './reconciliation.service';
import { ContractAccessService } from './contract-access.service';
import { CurrentUser, JwtAuthGuard, viewerOrThrow } from '../auth/auth.guard';
import type { AuthUser } from '../auth/auth.guard';
import { PlanService } from '../billing/plan.service';

// Địa chỉ công khai của backend (để dựng URL webhook)
const publicBase = (req: any) =>
  process.env.PUBLIC_API_URL ?? `${req.headers['x-forwarded-proto'] ?? req.protocol}://${req.headers.host}`;

@Controller('api/contracts')
export class SlaContractController {
  constructor(
    private readonly slaContractService: SlaContractService,
    private readonly oracleService: OracleService,
    private readonly access: ContractAccessService,
    private readonly jwt: JwtService,
    private readonly plans: PlanService,
    private readonly termination: TerminationAlertService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  // Tạo hợp đồng. Đã đăng nhập -> doanh nghiệp của người dùng tự động là 1 bên.
  // REQUIRE_AUTH=true -> bắt buộc đăng nhập.
  @Post('create')
  async create(@Body() createDto: any, @Req() req: any, @Headers('authorization') auth?: string) {
    return this.slaContractService.createContract(createDto, viewerOrThrow(this.jwt, auth), publicBase(req));
  }

  // Danh sách hợp đồng: đã đăng nhập -> chỉ hợp đồng mình là 1 bên (admin nền tảng thấy tất cả)
  @Get('list')
  async findAll(@Headers('authorization') auth?: string) {
    const viewer = viewerOrThrow(this.jwt, auth);
    return this.slaContractService.getAllContracts(this.access.scopeWhere(viewer));
  }

  // Danh sách nguồn dữ liệu của hợp đồng (phải là 1 bên) + hạn mức theo gói của doanh nghiệp mình
  @UseGuards(JwtAuthGuard)
  @Get(':id/oracle')
  async sources(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.access.assertParty(id, user.orgId);
    const plan = await this.plans.getState(user.orgId);
    return {
      sources: await this.oracleService.listSources(id),
      maxSources: plan.limits.maxSourcesPerContract,
      planName: plan.name,
      planActive: plan.active,
      ...(await this.oracleService.monitoringState(id)),
    };
  }

  // Thêm nguồn dữ liệu cho Oracle (phải là 1 bên, cần gói còn hiệu lực, trong hạn mức nguồn của gói):
  //   HTTP Health Check: { "sourceType": "HTTP_CHECK", "endpointUrl": "https://..." }  (thêm được nhiều URL)
  //   Webhook:           { "sourceType": "WEBHOOK" }  -> trả về webhookUrl có token (mỗi bên 1 webhook: client / provider; tạo lại = đổi token)
  @UseGuards(JwtAuthGuard)
  @Post(':id/oracle')
  async setOracle(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Body() body: { sourceType?: string; endpointUrl?: string },
    @Req() req: any,
  ) {
    const party = await this.access.assertParty(id, user.orgId);
    const isWebhook = body?.sourceType === 'WEBHOOK';
    const current = await this.oracleService.countSources(id);
    // Tạo lại webhook của chính bên mình không làm tăng số nguồn
    if (isWebhook && (await this.oracleService.hasWebhook(id, party))) await this.plans.requireActive(user.orgId);
    else await this.plans.assertSourceQuota(user.orgId, current);
    try {
      // Webhook: địa chỉ nhận dữ liệu của mỗi bên, tạo / đổi mã bí mật được cả trước và sau khi ký
      if (isWebhook) return await this.oracleService.setWebhook(id, publicBase(req), party);
      // URL HTTP Health Check: là điều khoản, chỉ thêm khi còn chờ ký (đã có bên ký -> huỷ chữ ký)
      return await this.slaContractService.changeHttpSource(id, user, { add: body?.endpointUrl ?? '' });
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(err?.message);
    }
  }

  // Gỡ 1 nguồn dữ liệu: URL HTTP chỉ gỡ được khi còn chờ ký; webhook chỉ gỡ được của chính bên mình
  @UseGuards(JwtAuthGuard)
  @Delete(':id/oracle/:configId')
  async removeSource(@Param('id') id: string, @Param('configId') configId: string, @CurrentUser() user: AuthUser) {
    const party = await this.access.assertParty(id, user.orgId);
    await this.plans.requireActive(user.orgId);
    try {
      const src = (await this.oracleService.listSources(id)).find((s) => s.id === configId);
      if (!src) throw new BadRequestException('Không tìm thấy nguồn dữ liệu');
      if (src.sourceType === 'HTTP_CHECK') return await this.slaContractService.changeHttpSource(id, user, { removeId: configId });
      if (src.party !== party) throw new ForbiddenException('Chỉ gỡ được webhook của chính bên mình');
      return await this.oracleService.removeSource(id, configId);
    } catch (err: any) {
      if (err instanceof HttpException) throw err;
      throw new BadRequestException(err?.message);
    }
  }

  // Uptime theo tháng + cảnh báo điều khoản chấm dứt (Uptime < 95% trong 2 tháng liên tiếp)
  @UseGuards(JwtAuthGuard)
  @Get(':id/uptime-history')
  async uptimeHistory(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    await this.access.assertParty(id, user.orgId);
    return this.termination.history(id);
  }

  // Tạm dừng / tiếp tục giám sát: hai bên KHÔNG được tự tạm dừng (tránh né đo). Chỉ admin nền tảng:
  //   POST /api/admin/contracts/:id/monitoring
  @UseGuards(JwtAuthGuard)
  @Post(':id/monitoring')
  monitoring() {
    throw new ForbiddenException('Hai bên không được tạm dừng giám sát. Liên hệ admin SLA-DEX nếu cần.');
  }

  // Đổi tên hợp đồng (phải là 1 bên): { "contractName": "..." } (rỗng = bỏ tên)
  @UseGuards(JwtAuthGuard)
  @Put(':id/name')
  async rename(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: { contractName?: string }) {
    await this.access.assertParty(id, user.orgId);
    return this.slaContractService.rename(id, body?.contractName);
  }

  // Sửa điều khoản khi hợp đồng còn "Chờ ký" (phải là 1 bên). Body giống lúc tạo: { service, kpis[], challengeWindowHours, note? }
  @UseGuards(JwtAuthGuard)
  @Put(':id/terms')
  async updateTerms(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: any) {
    await this.access.assertParty(id, user.orgId);
    await this.plans.requireActive(user.orgId);
    return this.slaContractService.updateTerms(id, body, user);
  }

  // KPI đo thật của hợp đồng (phải là 1 bên)
  @Get(':id/kpi')
  async kpi(@Param('id') id: string, @Headers('authorization') auth?: string) {
    await this.access.assertCanView(id, viewerOrThrow(this.jwt, auth));
    return this.oracleService.getKpiSummary(id);
  }

  // Báo cáo đối soát 1 kỳ (phải là 1 bên hoặc admin nền tảng). ?period=<số thứ tự kỳ>, bỏ trống = kỳ gần nhất
  @Get(':id/report')
  async report(@Param('id') id: string, @Query('period') period?: string, @Headers('authorization') auth?: string) {
    await this.access.assertCanView(id, viewerOrThrow(this.jwt, auth));
    return this.reconciliation.report(id, period);
  }

  // Kiểm chứng hash hợp đồng với blockchain (CÔNG KHAI: chỉ trả hash + kết quả, không lộ nội dung)
  @Get(':id/verify')
  async verify(@Param('id') id: string) {
    return this.slaContractService.verifyContract(id);
  }

  // Chi tiết 1 hợp đồng kèm danh sách KPI (phải là 1 bên)
  @Get(':id')
  async findOne(@Param('id') id: string, @Headers('authorization') auth?: string) {
    await this.access.assertCanView(id, viewerOrThrow(this.jwt, auth));
    return this.slaContractService.getContract(id);
  }
}
