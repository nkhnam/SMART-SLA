// THƯ VIỆN KPI + TEMPLATE THEO NGÀNH (SLA Builder No-code)

// Chiều so sánh: GTE = càng cao càng tốt (Uptime), LTE = càng thấp càng tốt (thời gian)
export type Comparator = 'GTE' | 'LTE';

// 1 bậc service credit: mức vi phạm < maxBreach -> hoàn creditBps (100 = 1%). maxBreach null = không giới hạn.
// Mức vi phạm:
//   GTE: số điểm % hụt so với cam kết (VD: cam kết 99.9, đo 99.2 -> vi phạm 0.7)
//   LTE: số % vượt ngưỡng (VD: cam kết 200ms, đo 300ms -> vi phạm 50)
export type CreditTier = { maxBreach: number | null; creditBps: number };

// Khung loại trừ lặp lại hằng tuần (VD: bảo trì 02:00-04:00 sáng Chủ nhật, giờ Việt Nam)
export type Exclusion = { dayOfWeek: number; start: string; end: string; note?: string };

export type KpiInput = {
  kpiCode: string;
  target: number;
  dataSource: string;
  windowMinutes?: number;
  exclusions?: Exclusion[];
  creditTiers?: CreditTier[];
  minPercent?: number; // KPI ticket: tỷ lệ tối thiểu số ticket phải đạt ngưỡng (VD 95)
};

// KPI đo theo ticket: kết quả = % ticket đạt ngưỡng thời gian (chuẩn ngành, không bị 1 ticket bất thường kéo lệch)
export const TICKET_KPIS = ['FIRST_RESPONSE', 'RESOLUTION_TIME'];

export const KPI_CATALOG: Record<
  string,
  {
    name: string;
    unit: string;
    comparator: Comparator;
    sources: string[];
    defaultTarget: number;
    defaultTiers: CreditTier[];
    description: string;
    defaultMinPercent?: number;
    maxTarget?: number;
  }
> = {
  UPTIME: {
    name: 'Uptime',
    unit: '%',
    comparator: 'GTE',
    sources: ['HTTP_CHECK', 'WEBHOOK'],
    defaultTarget: 99.9,
    // Đo theo số lần kiểm tra: trên 99,9% thì chỉ 1 lần lỗi đã là vi phạm, không công bằng
    maxTarget: 99.9,
    defaultTiers: [
      { maxBreach: 0.5, creditBps: 500 },
      { maxBreach: 1, creditBps: 1000 },
      { maxBreach: null, creditBps: 2000 },
    ],
    description: 'Tỷ lệ thời gian dịch vụ hoạt động bình thường',
  },
  RESPONSE_TIME: {
    name: 'Thời gian phản hồi hệ thống',
    unit: 'ms',
    comparator: 'LTE',
    sources: ['HTTP_CHECK', 'WEBHOOK'],
    defaultTarget: 200,
    defaultTiers: [
      { maxBreach: 50, creditBps: 500 },
      { maxBreach: 100, creditBps: 1000 },
      { maxBreach: null, creditBps: 2000 },
    ],
    description: 'Thời gian trung bình hệ thống trả lời một yêu cầu',
  },
  // Bậc phạt KPI ticket tính theo số ĐIỂM % hụt so với tỷ lệ cam kết (VD cam kết 95%, đạt 92% -> hụt 3 điểm)
  FIRST_RESPONSE: {
    name: 'Thời gian phản hồi ticket',
    unit: 'phút',
    comparator: 'LTE',
    sources: ['TICKET', 'WEBHOOK'],
    defaultTarget: 15,
    defaultMinPercent: 95,
    defaultTiers: [
      { maxBreach: 5, creditBps: 300 },
      { maxBreach: 15, creditBps: 700 },
      { maxBreach: null, creditBps: 1500 },
    ],
    description: 'Tỷ lệ ticket có người trả lời trong ngưỡng thời gian, tính từ lúc khách báo sự cố',
  },
  RESOLUTION_TIME: {
    name: 'Thời gian xử lý ticket',
    unit: 'giờ',
    comparator: 'LTE',
    sources: ['TICKET', 'WEBHOOK'],
    defaultTarget: 4,
    defaultMinPercent: 95,
    defaultTiers: [
      { maxBreach: 5, creditBps: 500 },
      { maxBreach: 15, creditBps: 1000 },
      { maxBreach: null, creditBps: 2000 },
    ],
    description: 'Tỷ lệ ticket được xử lý xong trong ngưỡng thời gian, tính từ lúc khách báo sự cố',
  },
  INCIDENT_RESPONSE: {
    name: 'Thời gian ứng phó sự cố an ninh',
    unit: 'phút',
    comparator: 'LTE',
    sources: ['WEBHOOK'],
    defaultTarget: 30,
    defaultTiers: [
      { maxBreach: 50, creditBps: 1000 },
      { maxBreach: 100, creditBps: 2000 },
      { maxBreach: null, creditBps: 3000 },
    ],
    description: 'Từ lúc phát hiện tấn công đến khi đội SOC bắt đầu xử lý',
  },
};

export const DATA_SOURCES: Record<string, string> = {
  HTTP_CHECK: 'HTTP Health Check (SMART-SLA tự đo)',
  WEBHOOK: 'Webhook 2 bên (client → provider), SMART-SLA đo song song để đối chiếu',
  TICKET: 'Chat hỗ trợ SMART-SLA',
};

// Kỳ đo mặc định theo thực tế: 30 ngày
export const DEFAULT_WINDOW_MINUTES = 30 * 24 * 60;

const SUNDAY_MAINTENANCE: Exclusion[] = [
  { dayOfWeek: 0, start: '02:00', end: '04:00', note: 'Bảo trì định kỳ sáng Chủ nhật' },
];

// Điều kiện bổ sung gợi ý theo từng mẫu (văn bản, không đo tự động; được băm và ký cùng hợp đồng).
// Tên các bên thống nhất theo hệ thống: "Bên mua" và "Nhà cung cấp".
const AUTO_RECORDING = 'Vi phạm cam kết SLA được SMART-SLA đo và ghi nhận tự động, kèm bằng chứng trên blockchain. Mỗi bên có quyền phản đối trong thời hạn phản đối của hợp đồng; quá hạn không có phản đối thì kết quả được chốt.';
const FORCE_MAJEURE = 'Bất khả kháng (thiên tai, dịch bệnh, chiến tranh, sự cố điện/viễn thông diện rộng, quyết định của cơ quan nhà nước): bên bị ảnh hưởng thông báo cho bên kia trong vòng 48 giờ kèm bằng chứng để được xem xét miễn trừ trách nhiệm trong thời gian xảy ra sự kiện.';
const DISPUTES = 'Hợp đồng áp dụng pháp luật Việt Nam. Tranh chấp ưu tiên thương lượng trong 30 ngày; nếu không thành, đưa ra Tòa án nhân dân có thẩm quyền tại TP. Hồ Chí Minh hoặc Trung tâm Trọng tài Quốc tế Việt Nam (VIAC) nếu hai bên chọn.';
const CONFIDENTIALITY = 'Mỗi bên giữ bí mật thông tin do bên kia cung cấp (dữ liệu khách hàng, cấu hình kỹ thuật, token/key kết nối) trong thời hạn hợp đồng và 03 năm sau khi chấm dứt.';

export const TEMPLATES: Record<
  string,
  { name: string; icon: string; serviceName: string; challengeWindowHours: number; kpis: KpiInput[]; conditions: string[] }
> = {
  CLOUD_HOSTING: {
    name: 'Cloud Hosting Standard',
    icon: '☁️',
    serviceName: 'Cloud Hosting & Storage',
    challengeWindowHours: 72,
    kpis: [
      {
        kpiCode: 'UPTIME',
        target: 99.9,
        dataSource: 'HTTP_CHECK',
        exclusions: SUNDAY_MAINTENANCE,
        // Uptime 99,0% đến dưới 99,9%: hoàn 5% | 95,0% đến dưới 99,0%: 10% | dưới 95,0%: 25% phí tháng
        creditTiers: [
          { maxBreach: 0.91, creditBps: 500 },
          { maxBreach: 4.91, creditBps: 1000 },
          { maxBreach: null, creditBps: 2500 },
        ],
      },
      { kpiCode: 'RESPONSE_TIME', target: 200, dataSource: 'HTTP_CHECK' },
    ],
    conditions: [
      AUTO_RECORDING,
      'Mức hoàn phí SLA được trừ vào phí dịch vụ kỳ kế tiếp hoặc quy đổi thành thời gian sử dụng cộng thêm, tối đa không vượt quá 100% phí dịch vụ của tháng bị ảnh hưởng.',
      'Không tính vào thời gian ngừng hoạt động: bảo trì đã thông báo trước tối thiểu 48 giờ; lỗi do Bên mua (mã nguồn, cấu hình, plugin, lạm dụng tài nguyên); tấn công mạng vượt khả năng phòng vệ thông thường; sự cố mạng quốc tế, nhà cung cấp viễn thông, điện lực; sự kiện bất khả kháng.',
      'Thời gian phản hồi hỗ trợ: sự cố nghiêm trọng trong vòng 02 giờ, sự cố thông thường trong vòng 08 giờ làm việc.',
      'Bên mua có quyền đơn phương chấm dứt hợp đồng ngay nếu Uptime dưới 95% trong 02 tháng liên tiếp và được hoàn phần phí chưa sử dụng.',
      'Dữ liệu khách hàng thuộc quyền sở hữu của Bên mua. Nhà cung cấp chỉ xử lý dữ liệu để cung cấp dịch vụ và thông báo cho Bên mua trong vòng 72 giờ kể từ khi phát hiện sự cố lộ lọt dữ liệu.',
      'Khi hợp đồng chấm dứt, Nhà cung cấp lưu giữ dữ liệu thêm 07 ngày để Bên mua tải về; sau thời hạn này dữ liệu được xóa vĩnh viễn.',
      CONFIDENTIALITY,
      'Tổng trách nhiệm bồi thường của Nhà cung cấp (ngoài hoàn phí SLA) không vượt quá tổng phí Bên mua đã thanh toán trong 12 tháng gần nhất, trừ trường hợp lỗi cố ý hoặc vi phạm nghĩa vụ bảo mật.',
      FORCE_MAJEURE,
      DISPUTES,
    ],
  },
  API_GATEWAY: {
    name: 'API Gateway Premium',
    icon: '⚡',
    serviceName: 'API Gateway',
    challengeWindowHours: 72,
    kpis: [
      { kpiCode: 'UPTIME', target: 99.9, dataSource: 'HTTP_CHECK' },
      { kpiCode: 'RESPONSE_TIME', target: 100, dataSource: 'HTTP_CHECK' },
    ],
    conditions: [
      AUTO_RECORDING,
      'Nhà cung cấp cấp quyền sử dụng hệ thống API Gateway Premium cho Bên mua, bao gồm khởi tạo, bàn giao tài khoản quản trị, hướng dẫn sử dụng và hỗ trợ kỹ thuật vận hành.',
      'Thông số kỹ thuật cam kết (số requests per second tối đa, dung lượng cache, giới hạn băng thông, số API endpoint được cấu hình) theo phụ lục hai bên đã thống nhất.',
      'Sự cố sập hệ thống: Nhà cung cấp phản hồi trong vòng 15 phút và khắc phục trong vòng 02 giờ.',
      'Nhà cung cấp có quyền tạm ngưng dịch vụ nếu Bên mua vi phạm nghĩa vụ thanh toán, sau khi đã thông báo bằng văn bản.',
      CONFIDENTIALITY,
      FORCE_MAJEURE,
      DISPUTES,
    ],
  },
  IT_SUPPORT: {
    name: 'IT Support / Managed Services',
    icon: '🛠️',
    serviceName: 'IT Support 8x5',
    challengeWindowHours: 72,
    kpis: [
      { kpiCode: 'FIRST_RESPONSE', target: 15, dataSource: 'TICKET', minPercent: 95 },
      { kpiCode: 'RESOLUTION_TIME', target: 4, dataSource: 'TICKET', minPercent: 95 },
    ],
    conditions: [
      AUTO_RECORDING,
      'Ticket tạo trên SMART-SLA hoặc gửi sang qua webhook từ hệ thống ticket hai bên đã thống nhất là nguồn dữ liệu chính thức để tính KPI.',
      'Thời gian hỗ trợ: 8 giờ/ngày, 5 ngày/tuần (giờ hành chính Việt Nam), trừ khi hai bên thỏa thuận khác.',
      CONFIDENTIALITY,
      DISPUTES,
    ],
  },
  SOC: {
    name: 'Cybersecurity SOC',
    icon: '🛡️',
    serviceName: 'Security Operations Center 24/7',
    challengeWindowHours: 48,
    kpis: [
      { kpiCode: 'INCIDENT_RESPONSE', target: 30, dataSource: 'WEBHOOK' },
      { kpiCode: 'UPTIME', target: 99.9, dataSource: 'WEBHOOK' },
    ],
    conditions: [
      AUTO_RECORDING,
      'Dịch vụ SOC không phải cam kết rằng hệ thống sẽ không bao giờ bị tấn công hoặc mất dữ liệu; cam kết được xác định qua khả năng giám sát, thời gian tiếp nhận, phân tích, thông báo và hỗ trợ ứng phó theo SLA.',
      'Trước ngày bắt đầu, hai bên lập Danh mục tài sản và nguồn log được giám sát. Tài sản và nguồn log ngoài danh mục không tính vào SLA cho đến khi được bổ sung.',
      'Nhà cung cấp không tự ý cô lập máy chủ, khóa tài khoản hoặc thay đổi cấu hình khi chưa có thẩm quyền theo ma trận phê duyệt đã thống nhất.',
      'Nhà cung cấp chỉ dùng dữ liệu của Bên mua cho mục đích cung cấp dịch vụ, bảo quản bằng chứng số và duy trì chain of custody; hỗ trợ xuất dữ liệu khi hợp đồng chấm dứt.',
      'Bên mua bảo đảm nguồn log được bật, đồng bộ thời gian, thông báo trước maintenance window và không làm gián đoạn agent, connector của dịch vụ.',
      CONFIDENTIALITY,
      DISPUTES,
    ],
  },
};
