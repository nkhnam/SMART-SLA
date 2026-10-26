// GÓI DỊCH VỤ SLA_DEX (đã chốt). Áp dụng cho MỌI doanh nghiệp (bên mua và nhà cung cấp).
// Bản demo: bấm đăng ký là kích hoạt ngay, KHÔNG thu tiền thật. Phân quyền chạy thật.
export type PlanCode = 'PILOT' | 'PAYG' | 'STARTER' | 'ENTERPRISE';

export type PlanDef = {
  code: PlanCode;
  name: string;
  tagline: string;
  priceLabel: string;
  priceNote: string;
  amountVnd: number; // số tiền ghi nhận cho mỗi lần đăng ký (demo)
  durationDays: number | null; // null = không hết hạn (Pay as you go)
  maxActiveSla: number | null; // null = không giới hạn
  maxSourcesPerContract: number | null; // số nguồn Oracle mỗi hợp đồng
  probeIntervalSeconds: number; // chu kỳ đo KPI
  reputationBadge: boolean; // hiện huy hiệu uy tín trên Marketplace
  featured: boolean; // ưu tiên vị trí trên Marketplace
  perContractVnd: number | null; // Pay as you go: phí mỗi hợp đồng tạo mới
  oneTime: boolean; // Pilot: mỗi doanh nghiệp chỉ dùng 1 lần
  features: string[];
};

export const PLANS: Record<PlanCode, PlanDef> = {
  PILOT: {
    code: 'PILOT',
    name: 'Pilot',
    tagline: 'Trải nghiệm đầy đủ luồng tạo SLA và kiểm chứng độ tin cậy, không tốn chi phí.',
    priceLabel: '0 ₫',
    priceNote: '30 ngày kể từ khi đăng ký gói, mỗi doanh nghiệp 1 lần',
    amountVnd: 0,
    durationDays: 30,
    maxActiveSla: 2,
    maxSourcesPerContract: 1,
    probeIntervalSeconds: 15 * 60,
    reputationBadge: false,
    featured: false,
    perContractVnd: null,
    oneTime: true,
    features: [
      'Dùng thử toàn bộ tính năng như gói trả phí',
      'Quản lý tối đa 2 SLA cùng lúc',
      'Tích hợp 1 công cụ đo lường cơ bản',
      'Chu kỳ kiểm tra KPI: 15 phút/lần',
      'Tự động ghi nhận vi phạm lên blockchain',
      'Xuất báo cáo đối soát PDF cơ bản (sắp ra mắt)',
      'Dashboard theo dõi tiêu chuẩn',
    ],
  },
  PAYG: {
    code: 'PAYG',
    name: 'Pay as you go',
    tagline: 'Cho doanh nghiệp làm dự án theo vụ việc, không muốn cam kết phí duy trì hàng tháng.',
    priceLabel: '500.000 ₫',
    priceNote: 'cho mỗi hợp đồng SLA tạo mới',
    amountVnd: 0,
    durationDays: null,
    maxActiveSla: null,
    maxSourcesPerContract: 2,
    probeIntervalSeconds: 5 * 60,
    reputationBadge: false,
    featured: false,
    perContractVnd: 500_000,
    oneTime: false,
    features: [
      'Trả phí trực tiếp cho mỗi lần khởi tạo 1 hợp đồng SLA',
      'Đầy đủ hash SLA, smart contract và đối soát suốt thời hạn hợp đồng',
      'Chu kỳ quét KPI: 5 phút/lần',
      'Tối đa 2 cổng Oracle Hub mỗi hợp đồng',
      'Tự động ghi nhận vi phạm lên blockchain',
    ],
  },
  STARTER: {
    code: 'STARTER',
    name: 'Starter',
    tagline: 'Cho công ty IT outsourcing, helpdesk, software house, doanh nghiệp vừa quản lý 5–20 đối tác.',
    priceLabel: '1.500.000 ₫',
    priceNote: '/ tháng',
    amountVnd: 1_500_000,
    durationDays: 30,
    maxActiveSla: 20,
    maxSourcesPerContract: 5,
    probeIntervalSeconds: 5 * 60,
    reputationBadge: true,
    featured: false,
    perContractVnd: null,
    oneTime: false,
    features: [
      'Quản lý tối đa 20 SLA cùng lúc',
      'Chu kỳ quét KPI: 5 phút/lần',
      'Tối đa 5 công cụ Oracle Hub mỗi hợp đồng',
      'Smart contract auto penalty: tự ghi nhận vi phạm và tính mức hoàn phí theo điều khoản',
      'Huy hiệu uy tín công khai trên Marketplace',
      'Hỗ trợ kỹ thuật qua email và live chat, phản hồi trong 2 giờ',
    ],
  },
  ENTERPRISE: {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    tagline: 'Cho nhà cung cấp hạ tầng cloud quy mô lớn (AWS/GCP reseller, IDC data center).',
    priceLabel: '3–10 triệu ₫',
    priceNote: '/ tháng, tuỳ quy mô',
    amountVnd: 3_000_000,
    durationDays: 30,
    maxActiveSla: null,
    maxSourcesPerContract: null,
    probeIntervalSeconds: 60,
    reputationBadge: true,
    featured: true,
    perContractVnd: null,
    oneTime: false,
    features: [
      'Không giới hạn số lượng SLA và đối tác',
      'Tần suất đo gần thời gian thực: 1 phút/lần',
      'Tích hợp custom API / Oracle riêng theo hạ tầng doanh nghiệp',
      'Báo cáo phân tích chuyên sâu: audit log, downtime analytics, xu hướng vi phạm (sắp ra mắt)',
      'Huy hiệu uy tín và ưu tiên vị trí top list trên Marketplace',
      'Hỗ trợ riêng 1-on-1 (account manager), cam kết SLA hỗ trợ 99.9%',
    ],
  },
};

export const PLAN_ORDER: PlanCode[] = ['PILOT', 'PAYG', 'STARTER', 'ENTERPRISE'];
