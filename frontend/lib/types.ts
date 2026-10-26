export type Party = "BUYER" | "SUPPLIER"

export type SessionUser = {
  id: string
  email: string
  fullName: string
  jobTitle?: string | null
  role: "ADMIN" | "OPERATIONS" | "LEGAL" | "PM"
  isActive: boolean
  platformAdmin?: boolean
  organization: { id: string; name: string; orgType: "BUYER" | "SUPPLIER" }
}

export type CreditTier = { maxBreach: number | null; creditBps: number }
export type Exclusion = { dayOfWeek: number; start: string; end: string; note?: string }

export type Kpi = {
  kpiCode: string
  name: string
  unit: string
  comparator: "GTE" | "LTE"
  target: number
  dataSource: string
  windowMinutes: number
  exclusions: Exclusion[]
  creditTiers: CreditTier[]
  minPercent?: number | null
}

export type ContractSignatureSummary = {
  party: Party
  method: string | null
  signedAt: string | null
  declaredWallet: string | null
}

export type Contract = {
  id: string
  contractCode: string
  contractName?: string | null
  serviceName: string
  status: string
  penaltyRule: string
  challengeWindowSeconds: number
  templateCode: string | null
  slaHash: string | null
  txHash: string | null
  createdAt: string
  client: { id: string; name: string; orgType?: string }
  provider: { id: string; name: string; serviceType?: string; organizationId?: string | null }
  kpis: Kpi[]
  oracleConfigs: { id: string; sourceType: string; endpointUrl: string | null; isActive: boolean }[]
  signatures?: ContractSignatureSummary[]
  termsVersion?: number
  additionalConditions?: string[]
  terminationAlert?: { threshold: number; at: string; periods: { label: string; uptime: number }[] } | null
  contractValueVnd?: number | null
  penaltyCap?: { percent: number; appliedVnd: number; capVnd: number; totalValueVnd: number; warnedLevels: number[]; reachedAt: string | null; capPercent?: number; warnLevels?: number[] } | null
  effectiveFrom?: string | null
  effectiveTo?: string | null
  contractAddress?: string | null
}

export type Violation = {
  id: string
  contractId: string
  kpiCode: string
  targetValue: number
  actualValue: number
  creditBps: number
  status: "PENDING" | "CHALLENGED" | "SETTLED" | "UPHELD" | "DISMISSED"
  challengeDeadline: string
  challengedBy: Party | null
  challengeReason: string | null
  resolution?: string | null
  resolutionNote?: string | null
  recordTxHash: string | null
  challengeTxHash: string | null
  settleTxHash: string | null
  createdAt: string
  contract: { contractCode: string; serviceName: string }
}

export type KpiResult = {
  kpiCode: string
  name: string
  unit: string
  comparator: string
  target: number
  actual: number | null
  ready: boolean
  breached: boolean
  samples: number
  windowStart: string
  downtimeSeconds?: number
  note?: string
}

export type KpiSummary = { contractId: string; source: string; monitoring: boolean; kpis: KpiResult[] }

export type CatalogKpi = {
  code: string
  name: string
  unit: string
  comparator: "GTE" | "LTE"
  sources: string[]
  defaultTarget: number
  defaultTiers: CreditTier[]
  description: string
  defaultMinPercent?: number
  maxTarget?: number
}

export type Catalog = {
  kpis: CatalogKpi[]
  dataSources: { code: string; label: string }[]
  templates: {
    code: string
    name: string
    icon: string
    serviceName: string
    challengeWindowHours: number
    kpis: Kpi[]
    conditions?: string[]
  }[]
}

export type Notification = {
  id: string
  type: string
  title: string
  message: string
  readAt: string | null
  createdAt: string
  contractId: string | null
}

export type ServiceListing = {
  id: string
  providerId: string
  title: string
  category: string
  description: string
  website: string | null
  priceNote: string | null
  challengeWindowHours: number
  kpis: Kpi[]
  status: "DRAFT" | "PENDING" | "APPROVED" | "REJECTED"
  rejectReason: string | null
  submittedAt: string | null
  reviewedAt: string | null
  updatedAt: string
  provider?: { id: string; name: string; serviceType?: string }
  additionalConditions?: string[]
  featured?: boolean // nhà cung cấp gói Enterprise: ưu tiên top list
}
