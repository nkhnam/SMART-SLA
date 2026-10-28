export type OrganizationRole = "OWNER" | "ADMIN" | "MEMBER";
export type OrganizationType = "CUSTOMER" | "PROVIDER" | "OTHER";

export type LiveOrganization = {
  id: string;
  name: string;
  organizationType: OrganizationType;
  role: OrganizationRole;
  createdAt: string;
};

export type AgreementTerms = {
  uptimeTargetPercent: number;
  responseTimeTargetMs: number;
  measurementWindowHours: number;
  exclusions: string[];
  notes: string | null;
};

export type AgreementStatus = "DRAFT" | "AWAITING_COUNTERPARTY" | "AWAITING_SIGNATURES" | "ANCHOR_PENDING" | "ANCHOR_CONFIRMED" | "ANCHOR_FAILED" | "REJECTED" | "CANCELLED";
export type SignatureStatus = "NOT_STARTED" | "PENDING" | "PARTIAL" | "COMPLETE" | "INVALIDATED";
export type AnchorStatus = "NOT_QUEUED" | "QUEUED" | "SUBMISSION_UNCERTAIN" | "SUBMITTED" | "CONFIRMED" | "FAILED" | "REPLACED" | "RECONCILIATION_REQUIRED";

export type TypedDataPayload = {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  primaryType: string;
  types: Record<string, Array<{ name: string; type: string }>>;
  message: Record<string, string | number | boolean | null>;
};

export type LiveAgreement = {
  id: string;
  reference: string;
  status: AgreementStatus;
  signatureStatus: SignatureStatus;
  blockchainStatus: AnchorStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  ownerOrganizationId?: string;
  name: string;
  serviceDescription: string;
  counterpartyDisplayName: string;
  terms: AgreementTerms;
  parties?: Array<{ organization: Pick<LiveOrganization, "id" | "name" | "organizationType">; role: "BUYER" | "SUPPLIER"; acceptedAt: string }>;
};

export type AuthorizedSigner = { id: string; address: string; verifiedAt: string; user: { id: string; displayName: string } };
export type AgreementInvitation = {
  id: string;
  agreementId: string;
  agreementVersion: number;
  status: "PENDING";
  expiresAt: string;
  createdAt: string;
  agreement: { id: string; reference: string; version: number; status: AgreementStatus; currentVersion: number };
  inviterOrganization: Pick<LiveOrganization, "id" | "name" | "organizationType">;
};
export type SigningSnapshotView = {
  id: string;
  version: number;
  snapshot: Record<string, unknown>;
  canonicalJson: string;
  hash: string;
  agreementKey: string;
  signatureStatus: SignatureStatus;
  validUntil: string;
  typedData: TypedDataPayload;
  signatures: Array<{ party: "BUYER" | "SUPPLIER"; signerAddress: string; submittedAt: string }>;
};
export type AgreementSigningView = {
  agreementId: string;
  version: number;
  agreementStatus: AgreementStatus;
  signatureStatus: SignatureStatus;
  snapshot: SigningSnapshotView | null;
};
export type AgreementAnchorView = {
  agreementId: string;
  version: number;
  agreementStatus: AgreementStatus;
  signatureStatus: SignatureStatus;
  blockchainStatus: AnchorStatus;
  anchor: null | { status: AnchorStatus; attemptCount: number; transactionHash: string | null; replacementHash: string | null; lastError: string | null; submittedAt: string | null; confirmedAt: string | null };
};

export type AgreementVersion = Omit<LiveAgreement, "id" | "reference" | "status" | "updatedAt" | "signatureStatus" | "blockchainStatus" | "parties"> & {
  actor: { id: string; displayName: string };
};

export type AgreementInput = {
  name: string;
  serviceDescription: string;
  counterpartyDisplayName: string;
  terms: {
    uptimeTargetPercent: number;
    responseTimeTargetMs: number;
    measurementWindowHours: number;
    exclusions: string[];
    notes?: string;
  };
};

export type AgreementList = {
  data: LiveAgreement[];
  page: number;
  pageSize: number;
  total: number;
};

export type MonitoringSource = { id: string; type: "HTTP_PROBE" | "SIGNED_WEBHOOK"; trustCategory: "OPERATOR_COLLECTED" | "PROVIDER_REPORTED" | "SYNTHETIC_TEST"; name: string; endpointUrl: string | null; intervalSeconds: number; retentionDays: number; enabled: boolean; nextRunAt: string | null; lastRunAt: string | null; createdAt: string; webhookSecret?: string | null };
export type MonitoringObservation = { id: string; agreementVersion: number; trustCategory: string; observedAt: string; scheduledFor: string; method: string; httpStatus: number | null; latencyMs: number | null; reachable: boolean | null; errorCategory: string | null; probeDurationMs: number | null; collectionRegion: string | null; agentIdentity: string | null; validity: string; source: { id: string; name: string; type: string; trustCategory: string } };
export type MonitoringEvaluation = { id: string; sourceId: string; agreementVersion: number; windowStart: string; windowEnd: string; expectedSamples: number; healthyObservations: number; failedObservations: number; unknownObservations: number; coveragePercent: string | number; uptimePercent: string | number | null; meanLatencyMs: string | number | null; state: string; algorithmVersion: string; source: { id: string; name: string; trustCategory: string } };
export type MonitoringBreach = { id: string; summary: string; state: string; createdAt: string; evaluation: MonitoringEvaluation };
export type EvidenceBatch = { id: string; agreementVersion: number; windowStart: string; windowEnd: string; schemaVersion: string; algorithmVersion: string; merkleRoot: string; batchDigest: string; observationCount: number; anchorIntent: { status: string; transactionChainId: number | null; transactionHash: string | null } | null; verification: { algorithm: string; root: string; independentlyVerifiable: boolean } };

export type CurrentSession = {
  user: { id: string; email: string; displayName: string };
  expiresAt: string;
};

export type RegisteredOrganization = Pick<LiveOrganization, "id" | "name" | "organizationType">;

export class ApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  organizationId?: string;
};

export function apiErrorFromPayload(status: number, payload: unknown): ApiError {
  const envelope = payload && typeof payload === "object" ? payload as { error?: { message?: unknown } } : undefined;
  const rawMessage = envelope?.error?.message;
  const message = typeof rawMessage === "string"
    ? rawMessage
    : Array.isArray(rawMessage) && rawMessage.every((item) => typeof item === "string")
      ? rawMessage.join(" ")
      : "The request could not be completed.";
  return new ApiError(message, status);
}

export async function requestApi<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "");
  if (!baseUrl) {
    throw new ApiError("Live workspace is not configured. Set NEXT_PUBLIC_API_BASE_URL and restart the frontend.");
  }

  const method = options.method ?? "GET";
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.organizationId) headers.set("x-organization-id", options.organizationId);
  if (method === "POST" || method === "PATCH") headers.set("x-sla-csrf", "1");

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "include",
      cache: "no-store"
    });
  } catch {
    throw new ApiError("The backend is unavailable. Check that PostgreSQL and the backend server are running.");
  }

  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw apiErrorFromPayload(response.status, payload);
  return payload as T;
}

export function login(input: { email: string; password: string }): Promise<CurrentSession> {
  return requestApi("/auth/login", { method: "POST", body: input });
}

export function register(input: {
  email: string;
  password: string;
  displayName: string;
  organizationName: string;
  organizationType: OrganizationType;
}): Promise<CurrentSession & { organization: RegisteredOrganization }> {
  return requestApi("/auth/register", { method: "POST", body: input });
}

export function getCurrentSession(): Promise<CurrentSession> {
  return requestApi("/auth/me");
}

export function getOrganizations(): Promise<LiveOrganization[]> {
  return requestApi("/organizations");
}

export function logout(): Promise<{ success: true }> {
  return requestApi("/auth/logout", { method: "POST" });
}

export function listAgreements(organizationId: string): Promise<AgreementList> {
  return requestApi("/agreements?page=1&pageSize=50&sort=updatedAt&order=desc", { organizationId });
}

export function getAgreement(organizationId: string, id: string): Promise<LiveAgreement> {
  return requestApi(`/agreements/${encodeURIComponent(id)}`, { organizationId });
}

export function createAgreement(organizationId: string, input: AgreementInput): Promise<LiveAgreement> {
  return requestApi("/agreements", { method: "POST", organizationId, body: input });
}

export function updateAgreement(
  organizationId: string,
  id: string,
  expectedVersion: number,
  input: AgreementInput
): Promise<LiveAgreement> {
  return requestApi(`/agreements/${encodeURIComponent(id)}`, {
    method: "PATCH",
    organizationId,
    body: { ...input, expectedVersion }
  });
}

export function listAgreementVersions(organizationId: string, id: string): Promise<AgreementVersion[]> {
  return requestApi(`/agreements/${encodeURIComponent(id)}/versions`, { organizationId });
}

export function amendAgreement(organizationId: string, id: string, expectedVersion: number, input: AgreementInput): Promise<LiveAgreement> {
  return requestApi(`/agreements/${encodeURIComponent(id)}/amend`, { method: "POST", organizationId, body: { ...input, expectedVersion } });
}

export function cancelAgreement(organizationId: string, id: string, expectedVersion: number): Promise<LiveAgreement> {
  return requestApi(`/agreements/${encodeURIComponent(id)}/cancel`, { method: "POST", organizationId, body: { expectedVersion } });
}

export function listAgreementInvitations(organizationId: string): Promise<AgreementInvitation[]> {
  return requestApi("/agreements/invitations", { organizationId });
}

export function createAgreementInvitation(organizationId: string, agreementId: string, counterpartyOrganizationId: string) {
  return requestApi<{ id: string; status: string; expiresAt: string }>(`/agreements/${encodeURIComponent(agreementId)}/invitations`, { method: "POST", organizationId, body: { organizationId: counterpartyOrganizationId } });
}

export function decideAgreementInvitation(organizationId: string, agreementId: string, invitationId: string, decision: "accept" | "reject") {
  return requestApi<{ id: string; status: string; version: number }>(`/agreements/${encodeURIComponent(agreementId)}/invitations/${encodeURIComponent(invitationId)}/${decision}`, { method: "POST", organizationId });
}

export function listAuthorizedSigners(organizationId: string): Promise<AuthorizedSigner[]> {
  return requestApi("/organizations/signers", { organizationId });
}

export function createSignerChallenge(organizationId: string, address: string) {
  return requestApi<{ challengeId: string; address: string; expiresAt: string; typedData: TypedDataPayload }>("/organizations/signers/challenge", { method: "POST", organizationId, body: { address } });
}

export function verifySignerChallenge(organizationId: string, challengeId: string, signature: `0x${string}`) {
  return requestApi<AuthorizedSigner>("/organizations/signers/verify", { method: "POST", organizationId, body: { challengeId, signature } });
}

export function selectAgreementSigner(organizationId: string, agreementId: string, authorizedSignerId: string) {
  return requestApi<{ agreementId: string; version: number; selected: true }>(`/agreements/${encodeURIComponent(agreementId)}/signers`, { method: "POST", organizationId, body: { authorizedSignerId } });
}

export function prepareAgreementSigning(organizationId: string, agreementId: string): Promise<SigningSnapshotView> {
  return requestApi(`/agreements/${encodeURIComponent(agreementId)}/signing/prepare`, { method: "POST", organizationId });
}

export function getAgreementSigning(organizationId: string, agreementId: string): Promise<AgreementSigningView> {
  return requestApi(`/agreements/${encodeURIComponent(agreementId)}/signing`, { organizationId });
}

export function submitAgreementSignature(organizationId: string, agreementId: string, signature: `0x${string}`) {
  return requestApi<{ agreementId: string; version: number; party: "BUYER" | "SUPPLIER"; signerAddress: string; signatureStatus: SignatureStatus }>(`/agreements/${encodeURIComponent(agreementId)}/signatures`, { method: "POST", organizationId, body: { signature } });
}

export function getAgreementAnchor(organizationId: string, agreementId: string): Promise<AgreementAnchorView> {
  return requestApi(`/agreements/${encodeURIComponent(agreementId)}/anchor`, { organizationId });
}

export function retryAgreementAnchor(organizationId: string, agreementId: string) {
  return requestApi<{ agreementId: string; version: number; blockchainStatus: AnchorStatus }>(`/agreements/${encodeURIComponent(agreementId)}/anchor/retry`, { method: "POST", organizationId });
}

export function verifyAgreementOnChain(organizationId: string, agreementId: string) {
  return requestApi<{ agreementId: string; version: number; verified: boolean; reason?: string; transactionHash?: string | null }>(`/agreements/${encodeURIComponent(agreementId)}/verification`, { organizationId });
}

export function listMonitoringSources(organizationId: string, agreementId: string): Promise<MonitoringSource[]> {
  return requestApi(`/agreements/${encodeURIComponent(agreementId)}/monitoring/sources`, { organizationId });
}

export function createMonitoringSource(organizationId: string, agreementId: string, body: { type: MonitoringSource["type"]; name: string; endpointUrl?: string; intervalSeconds: number; retentionDays: number }): Promise<MonitoringSource> {
  return requestApi(`/agreements/${encodeURIComponent(agreementId)}/monitoring/sources`, { method: "POST", organizationId, body });
}

export function updateMonitoringSource(organizationId: string, agreementId: string, sourceId: string, body: { enabled?: boolean; rotateWebhookSecret?: boolean }): Promise<MonitoringSource> {
  return requestApi(`/agreements/${encodeURIComponent(agreementId)}/monitoring/sources/${encodeURIComponent(sourceId)}`, { method: "PATCH", organizationId, body });
}

export function listMonitoringObservations(organizationId: string, agreementId: string): Promise<{ data: MonitoringObservation[]; total: number }> {
  return requestApi(`/agreements/${encodeURIComponent(agreementId)}/monitoring/observations?page=1&pageSize=100`, { organizationId });
}

export function listMonitoringKpis(organizationId: string, agreementId: string): Promise<MonitoringEvaluation[]> {
  return requestApi(`/agreements/${encodeURIComponent(agreementId)}/monitoring/kpis`, { organizationId });
}

export function evaluateMonitoringKpis(organizationId: string, agreementId: string, body: { windowStart: string; windowEnd: string }): Promise<{ data: MonitoringEvaluation[] }> {
  return requestApi(`/agreements/${encodeURIComponent(agreementId)}/monitoring/kpis/evaluate`, { method: "POST", organizationId, body });
}

export function listMonitoringBreaches(organizationId: string, agreementId: string): Promise<MonitoringBreach[]> {
  return requestApi(`/agreements/${encodeURIComponent(agreementId)}/monitoring/breaches`, { organizationId });
}

export function buildEvidenceBatch(organizationId: string, agreementId: string, body: { windowStart: string; windowEnd: string }): Promise<EvidenceBatch> {
  return requestApi(`/agreements/${encodeURIComponent(agreementId)}/monitoring/evidence`, { method: "POST", organizationId, body });
}

export function exportEvidenceBatch(organizationId: string, agreementId: string, batchId: string): Promise<Record<string, unknown>> {
  return requestApi(`/agreements/${encodeURIComponent(agreementId)}/monitoring/evidence/${encodeURIComponent(batchId)}`, { organizationId });
}
