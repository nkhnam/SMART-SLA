// Nguồn dữ liệu của 1 hợp đồng và thứ tự ưu tiên khi tính KPI.
//   - Nguồn gốc do SMART-SLA tự đo (luôn chạy song song để đối chiếu):
//       Uptime, thời gian phản hồi: HTTP_CHECK | KPI ticket: chat hỗ trợ của SMART-SLA
//   - Webhook client (bên mua) và webhook provider (nhà cung cấp): mỗi bên tối đa 1 địa chỉ.
// Ưu tiên tính KPI: webhook client > webhook provider > nguồn gốc của SMART-SLA.
//   Uptime: theo webhook đã kết nối. Thời gian phản hồi, ticket: theo webhook có gửi dữ liệu loại đó trong kỳ.
// Bên của webhook lưu ở cột endpointUrl ('BUYER' | 'SUPPLIER'); webhook tạo trước bản cập nhật (null) coi là provider.

export type HookParty = 'BUYER' | 'SUPPLIER';
export type SourceKey = 'BASE' | 'WEBHOOK_CLIENT' | 'WEBHOOK_PROVIDER';
export const HOOK_PARTIES: HookParty[] = ['BUYER', 'SUPPLIER'];

// Mã sự kiện UP/DOWN trong SlaEventLog theo từng bên. WEBHOOK_EVENT = sự kiện cũ, thuộc webhook provider.
export const HOOK_EVENT_CODES: Record<HookParty, string[]> = {
  BUYER: ['WEBHOOK_CLIENT'],
  SUPPLIER: ['WEBHOOK_PROVIDER', 'WEBHOOK_EVENT'],
};
// Mã sự kiện thời gian phản hồi (ms) do webhook gửi sang
export const LATENCY_CODES: Record<HookParty, string> = {
  BUYER: 'WEBHOOK_CLIENT_LATENCY',
  SUPPLIER: 'WEBHOOK_PROVIDER_LATENCY',
};

export const hookEventCode = (party: HookParty) => (party === 'BUYER' ? 'WEBHOOK_CLIENT' : 'WEBHOOK_PROVIDER');
export const hookSource = (party: HookParty): SourceKey => (party === 'BUYER' ? 'WEBHOOK_CLIENT' : 'WEBHOOK_PROVIDER');
export const hookLabel = (party: HookParty) => (party === 'BUYER' ? 'webhook client' : 'webhook provider');

type Cfg = { sourceType: string; endpointUrl?: string | null; isActive?: boolean };

export const hookPartyOf = (cfg: Cfg): HookParty => (cfg.endpointUrl === 'BUYER' ? 'BUYER' : 'SUPPLIER');

export const webhooksOf = <T extends Cfg>(cfgs: T[]) => cfgs.filter((o) => o.sourceType === 'WEBHOOK' && o.isActive !== false);

export const hookOf = <T extends Cfg>(cfgs: T[], party: HookParty): T | null =>
  webhooksOf(cfgs).find((h) => hookPartyOf(h) === party) ?? null;

// Webhook dùng để tính Uptime: client trước, provider sau
export function primaryHook<T extends Cfg>(cfgs: T[]): T | null {
  return hookOf(cfgs, 'BUYER') ?? hookOf(cfgs, 'SUPPLIER');
}

// Ticket nhận qua webhook: ticket của webhook client lưu mã "client:<mã>", của provider giữ nguyên mã
// (cùng 1 ticket do cả 2 bên gửi sang được lưu thành 2 bản để đối chiếu)
const CLIENT_PREFIX = 'client:';
export const ticketKey = (party: HookParty, externalId: string) => (party === 'BUYER' ? `${CLIENT_PREFIX}${externalId}` : externalId);
export const ticketRawId = (externalId: string | null) => (externalId?.startsWith(CLIENT_PREFIX) ? externalId.slice(CLIENT_PREFIX.length) : externalId);
// Điều kiện lọc ticket theo nguồn
export const ticketWhere = (src: 'BASE' | HookParty) =>
  src === 'BASE'
    ? { source: { not: 'WEBHOOK' } }
    : src === 'BUYER'
      ? { source: 'WEBHOOK', externalId: { startsWith: CLIENT_PREFIX } }
      : { source: 'WEBHOOK', NOT: { externalId: { startsWith: CLIENT_PREFIX } } };
