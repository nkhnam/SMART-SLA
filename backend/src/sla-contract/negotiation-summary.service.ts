import { BadRequestException, HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContractAccessService } from './contract-access.service';
import { PlanService } from '../billing/plan.service';
import { AuthUser } from '../auth/auth.guard';

// TÓM TẮT BÀN BẠC BẰNG AI (Gemini, chạy ở backend -> API key không lộ ra trình duyệt)
// Đầu vào: luồng "Bàn bạc điều khoản" + điều khoản hiện tại của hợp đồng.
// AI chỉ GỢI Ý: con người vẫn phải sửa điều khoản và ký. Không đưa kết luận pháp lý.
const API_KEY = () => process.env.GEMINI_API_KEY ?? '';
const MODEL = () => process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const MAX_MESSAGES = 200;
const COOLDOWN_MS = 20_000; // chống bấm liên tục làm tốn hạn mức API

const RECOMMENDATIONS = ['Có thể ký sau khi kiểm tra', 'Cần bàn bạc thêm', 'Cân nhắc từ chối'] as const;

const SYSTEM_PROMPT = [
  'Bạn là trợ lý tóm tắt cuộc bàn bạc hợp đồng SLA giữa Bên mua và Nhà cung cấp trên nền tảng SLA-DEX.',
  'Chỉ dùng nội dung tin nhắn và điều khoản được cung cấp, không tự bịa dữ liệu, không đưa ra kết luận pháp lý.',
  'Chỉ đưa một nội dung vào "agreedChanges" hoặc "agreedConditions" khi CẢ HAI bên đã xác nhận rõ ràng.',
  'Nội dung còn tranh luận, mơ hồ hoặc mới chỉ một bên đề xuất thì đưa vào "pending".',
  'agreedChanges: thay đổi về KPI / ngưỡng / mức hoàn phí / thời hạn phản đối, ghi ngắn gọn kèm đơn vị (VD "Uptime ≥ 99,5%").',
  'agreedConditions: điều kiện bổ sung dạng văn bản, viết thành câu hoàn chỉnh, gọi hai bên là "Bên mua" và "Nhà cung cấp".',
  'Tin nhắn bắt đầu bằng "[Hệ thống]" là thông báo tự động của nền tảng, dùng làm ngữ cảnh.',
  'Trả lời bằng tiếng Việt. "recommendation" chỉ là gợi ý để con người xem lại.',
].join('\n');

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    overview: { type: 'STRING' },
    recommendation: { type: 'STRING', enum: [...RECOMMENDATIONS] },
    agreedChanges: { type: 'ARRAY', items: { type: 'STRING' } },
    agreedConditions: { type: 'ARRAY', items: { type: 'STRING' } },
    pending: { type: 'ARRAY', items: { type: 'STRING' } },
  },
  required: ['overview', 'recommendation', 'agreedChanges', 'agreedConditions', 'pending'],
};

const cleanList = (v: unknown) =>
  (Array.isArray(v) ? v : [])
    .filter((x): x is string => typeof x === 'string' && !!x.trim())
    .slice(0, 20)
    .map((x) => x.trim().slice(0, 1000));

@Injectable()
export class NegotiationSummaryService {
  private readonly logger = new Logger(NegotiationSummaryService.name);
  private lastCall = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private access: ContractAccessService,
    private plans: PlanService,
  ) {}

  get enabled() {
    return !!API_KEY();
  }

  async summarize(contractId: string, user: AuthUser) {
    await this.access.assertParty(contractId, user.orgId);
    await this.plans.requireActive(user.orgId);
    if (!this.enabled) throw new ServiceUnavailableException('Chưa cấu hình dịch vụ AI tóm tắt (GEMINI_API_KEY)');

    const last = this.lastCall.get(contractId) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) {
      throw new HttpException('Vừa tóm tắt xong, vui lòng chờ vài giây rồi thử lại', HttpStatus.TOO_MANY_REQUESTS);
    }

    const contract = await this.prisma.slaContract.findUnique({
      where: { id: contractId },
      include: { kpis: true, client: { select: { name: true } }, provider: { select: { name: true } } },
    });
    if (!contract) throw new BadRequestException('Không tìm thấy hợp đồng');

    const thread = await this.prisma.ticket.findFirst({ where: { contractId, kind: 'NEGOTIATION' } });
    const all = thread
      ? await this.prisma.ticketMessage.findMany({ where: { ticketId: thread.id }, orderBy: { createdAt: 'asc' } })
      : [];
    if (!all.some((m) => !m.body.startsWith('[Hệ thống]'))) throw new BadRequestException('Chưa có tin nhắn bàn bạc để tóm tắt');
    const messages = all.slice(-MAX_MESSAGES);

    const input = {
      contract: {
        code: contract.contractCode,
        status: contract.status,
        service: contract.serviceName,
        buyer: contract.client.name,
        provider: contract.provider.name,
        challengeWindowHours: Math.round(contract.challengeWindowSeconds / 3600),
        kpis: contract.kpis.map((k) => ({
          name: k.name,
          target: `${k.comparator === 'GTE' ? '≥' : '≤'} ${k.target}${k.unit}`,
          minPercentOfTickets: k.minPercent,
          creditTiers: k.creditTiers,
        })),
        additionalConditions: contract.additionalConditions,
      },
      messages: messages.map((m) => ({
        side: m.authorParty === 'BUYER' ? 'Bên mua' : 'Nhà cung cấp',
        author: m.authorName,
        time: m.createdAt.toISOString(),
        text: m.body,
      })),
    };

    this.lastCall.set(contractId, Date.now());
    let parsed: any;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL())}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY() },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
          generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
        }),
        signal: AbortSignal.timeout(45_000),
      });
      if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const json: any = await res.json();
      const text = json?.candidates?.[0]?.content?.parts?.map((p: any) => p?.text ?? '').join('') ?? '';
      if (!text) throw new Error('AI không trả nội dung');
      parsed = JSON.parse(text);
    } catch (err: any) {
      this.logger.warn(`Tóm tắt bàn bạc ${contract.contractCode} lỗi: ${err?.message}`);
      throw new ServiceUnavailableException('AI chưa tạo được bản tóm tắt. Vui lòng thử lại sau.');
    }

    return {
      overview: String(parsed?.overview ?? '').slice(0, 2000),
      recommendation: RECOMMENDATIONS.includes(parsed?.recommendation) ? parsed.recommendation : 'Cần bàn bạc thêm',
      agreedChanges: cleanList(parsed?.agreedChanges),
      agreedConditions: cleanList(parsed?.agreedConditions),
      pending: cleanList(parsed?.pending),
      messageCount: messages.length,
      truncated: all.length > messages.length,
      model: MODEL(),
      generatedAt: new Date().toISOString(),
    };
  }
}
