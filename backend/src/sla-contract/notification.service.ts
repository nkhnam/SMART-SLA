import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// Các loại sự kiện gửi thông báo
export type NotifyEvent =
  | 'VIOLATION_OPENED' // phát hiện vi phạm, mở Challenge Window
  | 'DEADLINE_SOON' // sắp hết hạn phản đối
  | 'CHALLENGED' // một bên đã phản đối
  | 'SETTLED' // hết hạn, tự động chốt
  | 'RESOLVED'; // admin đã xử lý vụ bị phản đối

type Party = 'BUYER' | 'SUPPLIER';

// Kết nối Dify Workflow (soạn nội dung + gửi email). Thiếu -> dùng mẫu soạn sẵn, chỉ thông báo trong web.
const DIFY_API_URL = (process.env.DIFY_API_URL ?? '').replace(/\/$/, ''); // VD: https://api.dify.ai/v1
const DIFY_API_KEY = process.env.DIFY_API_KEY ?? ''; // API key của Workflow app (app-...)
const APP_URL = process.env.APP_URL ?? ''; // VD: https://smart-sla.vercel.app (link trong thông báo)
const DIFY_TIMEOUT_MS = 30_000;
// Workflow Dify thứ 2 CHỈ gửi email (không có LLM) - dùng cho mã OTP, nội dung không được để AI chỉnh sửa
const DIFY_MAIL_API_KEY = process.env.DIFY_MAIL_API_KEY ?? '';

const fmtVN = (d: Date) => d.toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private prisma: PrismaService) {}

  // Gửi thông báo về 1 vụ vi phạm cho CẢ HAI BÊN của hợp đồng.
  // Gọi kiểu "bắn và quên": không làm chậm hay làm hỏng luồng chính nếu Dify lỗi.
  fire(event: NotifyEvent, violationId: string) {
    this.notifyViolation(event, violationId).catch((err) =>
      this.logger.error(`Gửi thông báo ${event} thất bại: ${err?.message}`),
    );
  }

  private async notifyViolation(event: NotifyEvent, violationId: string) {
    const vc = await this.prisma.violationCase.findUnique({
      where: { id: violationId },
      include: { contract: { include: { kpis: true, provider: true } } },
    });
    if (!vc) return;
    const c = vc.contract;
    const kpi = c.kpis.find((k) => k.kpiCode === vc.kpiCode);

    const parties: { role: Party; orgId: string | null }[] = [
      { role: 'BUYER', orgId: c.clientId },
      { role: 'SUPPLIER', orgId: c.provider?.organizationId ?? null },
    ];

    for (const p of parties) {
      if (!p.orgId) continue; // bên này chưa có tài khoản trên SMART-SLA -> không có ai để báo

      const org = await this.prisma.organization.findUnique({
        where: { id: p.orgId },
        include: { users: { where: { isActive: true }, select: { email: true, fullName: true, role: true } } },
      });
      if (!org) continue;

      // Dữ liệu gửi sang Dify: chỉ những gì cần cho nội dung thông báo
      const inputs = {
        event_type: event,
        recipient_role: p.role,
        recipient_org: org.name,
        recipient_emails: org.users.map((u) => u.email).join(','),
        recipient_names: org.users.map((u) => u.fullName).join(', '),
        contract_code: c.contractCode,
        service_name: c.serviceName,
        kpi_name: kpi?.name ?? vc.kpiCode,
        unit: kpi?.unit ?? '',
        target: String(vc.targetValue),
        actual: String(vc.actualValue),
        credit_percent: String(vc.creditBps / 100),
        deadline: fmtVN(vc.challengeDeadline),
        challenged_by: vc.challengedBy ?? '',
        challenge_reason: vc.challengeReason ?? '',
        resolution: vc.status === 'UPHELD' ? 'GIỮ NGUYÊN VI PHẠM' : vc.status === 'DISMISSED' ? 'HUỶ VI PHẠM' : '',
        resolution_note: vc.resolutionNote ?? '',
        app_url: APP_URL,
      };

      const fallback = this.template(event, p.role, inputs);
      let title = fallback.title;
      let message = fallback.message;
      let aiGenerated = false;
      let emailStatus = 'SKIPPED';

      if (DIFY_API_URL && DIFY_API_KEY && org.users.length) {
        try {
          const out = await this.callDify(inputs);
          if (out.title && out.message) {
            title = String(out.title).slice(0, 200);
            message = String(out.message).slice(0, 4000);
            aiGenerated = true;
          }
          emailStatus = String(out.email_status ?? 'SENT');
        } catch (err: any) {
          emailStatus = 'FAILED';
          this.logger.warn(`Dify lỗi (${event}, ${c.contractCode}, ${p.role}) -> dùng mẫu soạn sẵn: ${err?.message}`);
        }
      }

      await this.prisma.notification.create({
        data: {
          organizationId: org.id,
          contractId: c.id,
          violationId: vc.id,
          type: event,
          title,
          message,
          aiGenerated,
          emailStatus,
        },
      });
    }
  }

  // Gọi Dify Workflow (chế độ blocking: chờ kết quả)
  private async callDify(inputs: Record<string, string>) {
    const res = await fetch(`${DIFY_API_URL}/workflows/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${DIFY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs, response_mode: 'blocking', user: 'smart-sla-backend' }),
      signal: AbortSignal.timeout(DIFY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json: any = await res.json();
    if (json?.data?.status !== 'succeeded') {
      throw new Error(`Workflow ${json?.data?.status ?? 'không rõ'}: ${json?.data?.error ?? ''}`);
    }
    return (json.data.outputs ?? {}) as { title?: string; message?: string; email_status?: string };
  }

  // Gửi email nội dung CỐ ĐỊNH qua workflow Dify "chỉ gửi mail" (Start -> send email -> End)
  get canSendDirectEmail(): boolean {
    return !!(DIFY_API_URL && DIFY_MAIL_API_KEY);
  }

  async sendDirectEmail(toEmail: string, subject: string, content: string) {
    if (!this.canSendDirectEmail) throw new Error('Chưa cấu hình DIFY_MAIL_API_KEY');
    const res = await fetch(`${DIFY_API_URL}/workflows/run`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${DIFY_MAIL_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inputs: { to_email: toEmail, subject, content },
        response_mode: 'blocking',
        user: 'smart-sla-backend',
      }),
      signal: AbortSignal.timeout(DIFY_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json: any = await res.json();
    if (json?.data?.status !== 'succeeded') throw new Error(`Workflow ${json?.data?.status}: ${json?.data?.error ?? ''}`);
  }

  // Mẫu thông báo soạn sẵn (dùng khi chưa cấu hình hoặc Dify lỗi)
  private template(event: NotifyEvent, role: Party, i: Record<string, string>) {
    const head = `[${i.contract_code}] ${i.kpi_name}`;
    const measured = `đo được ${i.actual}${i.unit}, cam kết ${i.target}${i.unit}`;
    switch (event) {
      case 'VIOLATION_OPENED':
        return role === 'BUYER'
          ? { title: `${head}: phát hiện vi phạm SLA`, message: `Nhà cung cấp vi phạm ${i.kpi_name} (${measured}). Đề xuất hoàn ${i.credit_percent}% phí. Kết quả sẽ tự động chốt lúc ${i.deadline} nếu không có phản đối.` }
          : { title: `${head}: hệ thống ghi nhận vi phạm`, message: `Dịch vụ ${i.service_name} vi phạm ${i.kpi_name} (${measured}). Đề xuất hoàn ${i.credit_percent}% phí cho khách hàng. Bạn có thể phản đối trước ${i.deadline} nếu có căn cứ (VD: bảo trì đã thông báo).` };
      case 'DEADLINE_SOON':
        return { title: `${head}: sắp hết hạn phản đối`, message: `Vụ vi phạm sẽ tự động chốt lúc ${i.deadline} (hoàn ${i.credit_percent}% phí). Nếu có căn cứ phản đối, hãy gửi trước thời điểm này.` };
      case 'CHALLENGED':
        return { title: `${head}: vụ vi phạm bị phản đối`, message: `${i.challenged_by === 'BUYER' ? 'Bên mua' : 'Nhà cung cấp'} đã phản đối với lý do: "${i.challenge_reason}". Vụ việc chuyển sang xử lý ngoại lệ.` };
      case 'SETTLED':
        return { title: `${head}: đã chốt kết quả`, message: `Hết hạn phản đối, kết quả được chốt tự động: hoàn ${i.credit_percent}% phí theo điều khoản hợp đồng.` };
      case 'RESOLVED':
        return { title: `${head}: đã có kết quả xử lý`, message: `Admin SMART-SLA quyết định ${i.resolution}. Ghi chú: ${i.resolution_note}` };
    }
  }

  // API cho giao diện (chuông thông báo)
  list(orgId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: { organizationId: orgId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async markRead(orgId: string, id: string) {
    await this.prisma.notification.updateMany({ where: { id, organizationId: orgId }, data: { readAt: new Date() } });
    return { ok: true };
  }

  async markAllRead(orgId: string) {
    const r = await this.prisma.notification.updateMany({
      where: { organizationId: orgId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: r.count };
  }
}
