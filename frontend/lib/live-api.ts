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

export type LiveAgreement = {
  id: string;
  reference: string;
  status: "DRAFT";
  version: number;
  createdAt: string;
  updatedAt: string;
  name: string;
  serviceDescription: string;
  counterpartyDisplayName: string;
  terms: AgreementTerms;
};

export type AgreementVersion = Omit<LiveAgreement, "id" | "reference" | "status" | "updatedAt"> & {
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
