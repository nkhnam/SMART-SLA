import assert from "node:assert/strict";
import { test } from "node:test";
import { toAgreementListItem } from "../lib/agreement-mapping.ts";
import { ApiError, apiErrorFromPayload, requestApi } from "../lib/live-api.ts";

test("agreement mapping presents live fields without reading fixture data", () => {
  const item = toAgreementListItem({
    id: "agreement-id",
    reference: "SLA-ABC123",
    status: "DRAFT",
    version: 3,
    createdAt: "2026-10-20T10:00:00.000Z",
    updatedAt: "2026-10-26T10:00:00.000Z",
    name: "Managed API service",
    serviceDescription: "Hosting and support",
    counterpartyDisplayName: "Unverified Counterparty",
    terms: {
      uptimeTargetPercent: 99.95,
      responseTimeTargetMs: 180,
      measurementWindowHours: 24,
      exclusions: [],
      notes: null
    }
  });

  assert.deepEqual(item, {
    id: "agreement-id",
    reference: "SLA-ABC123",
    name: "Managed API service",
    counterparty: "Unverified Counterparty",
    uptimeTarget: "99.95%",
    responseTarget: "180 ms",
    versionLabel: "v3",
    updatedAt: "2026-10-26T10:00:00.000Z"
  });
});

test("API error mapping keeps safe server validation messages", () => {
  const error = apiErrorFromPayload(400, { error: { message: ["uptimeTargetPercent must not be greater than 100"] } });
  assert.equal(error.status, 400);
  assert.equal(error.message, "uptimeTargetPercent must not be greater than 100");
});

test("API request reports an unavailable backend without substituting sample data", async () => {
  const originalBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.NEXT_PUBLIC_API_BASE_URL = "http://localhost:4000/api/v1";
  globalThis.fetch = async () => { throw new Error("network unavailable"); };
  try {
    await assert.rejects(requestApi("/auth/me"), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.message, "The backend is unavailable. Check that PostgreSQL and the backend server are running.");
      return true;
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBaseUrl === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = originalBaseUrl;
  }
});
