import { expect, test, type Page } from "@playwright/test";

const organizationId = "11111111-1111-4111-8111-111111111111";
const agreementId = "22222222-2222-4222-8222-222222222222";
const agreement = {
  id: agreementId, reference: "SLA-REVIEW", version: 1,
  name: "Older confirmed service", serviceDescription: "Managed service with a reviewable signed commitment",
  counterpartyDisplayName: "Review provider", ownerOrganizationId: "other-organization",
  status: "ANCHOR_CONFIRMED", signatureStatus: "COMPLETE", blockchainStatus: "CONFIRMED",
  createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z",
  terms: { uptimeTargetPercent: 99.95, responseTimeTargetMs: 180, measurementWindowHours: 24, exclusions: ["Scheduled maintenance"], notes: "Notify both organizations of an incident." }
};

async function mockWorkspace(page: Page, status = "ANCHOR_CONFIRMED") {
  const record = { ...agreement, status };
  const snapshot = status === "ANCHOR_CONFIRMED" ? {
    id: "snapshot-1", version: 1, snapshot: { serviceDescription: agreement.serviceDescription, terms: agreement.terms },
    canonicalJson: "{}", hash: `0x${"11".repeat(32)}`, agreementKey: `0x${"22".repeat(32)}`,
    signatureStatus: "COMPLETE", validUntil: "2027-01-01T00:00:00.000Z",
    typedData: { domain: { name: "SLA-DEX", version: "1", chainId: 31337, verifyingContract: `0x${"33".repeat(20)}` }, primaryType: "Agreement", types: {}, message: { buyerSigner: `0x${"44".repeat(20)}`, supplierSigner: `0x${"55".repeat(20)}` } },
    signatures: [{ party: "BUYER" }, { party: "SUPPLIER" }]
  } : null;
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.slice("/api/v1".length);
    let payload: unknown;
    if (path === "/auth/me") payload = { user: { id: "review-user", displayName: "Review user", email: "review@example.test" }, expiresAt: "2027-01-01T00:00:00.000Z" };
    else if (path === "/organizations") payload = [{ id: organizationId, name: "Review organization", organizationType: "CUSTOMER", role: "OWNER", createdAt: agreement.createdAt }];
    else if (path === "/agreements") {
      const pageNumber = Number(url.searchParams.get("page"));
      payload = { data: pageNumber === 1 ? Array.from({ length: 50 }, (_, index) => ({ ...agreement, id: `draft-${index}`, name: `Recent draft ${index}`, status: "DRAFT" })) : [record], page: pageNumber, pageSize: 50, total: 51 };
    }
    else if (path === "/agreements/invitations" || path === "/organizations/signers") payload = [];
    else if (path === `/agreements/${agreementId}`) payload = record;
    else if (path === `/agreements/${agreementId}/versions`) payload = [{ ...record, actor: { id: "review-user", displayName: "Review user" } }];
    else if (path === `/agreements/${agreementId}/signing`) payload = { agreementId, version: 1, agreementStatus: status, signatureStatus: record.signatureStatus, snapshot };
    else if (path === `/agreements/${agreementId}/anchor`) payload = { agreementId, version: 1, agreementStatus: status, signatureStatus: record.signatureStatus, blockchainStatus: record.blockchainStatus, anchor: null };
    else if (path.endsWith("/monitoring/observations")) payload = { data: [], total: 0 };
    else if (["/monitoring/sources", "/monitoring/kpis", "/monitoring/breaches"].some((suffix) => path.endsWith(suffix))) payload = [];
    else { await route.fulfill({ status: 404, json: { error: { message: `Unexpected fixture request: ${path}` } } }); return; }
    await route.fulfill({ status: 200, json: payload });
  });
}

test("organization IDs are discoverable and copyable for counterparties", async ({ page, context }) => {
  await mockWorkspace(page);
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/workspace/agreements");
  await expect(page.getByText(organizationId, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Copy organization ID" }).click();
  await expect(page.getByText("Organization ID copied.", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(organizationId);
});

test("counterparties can review complete terms before a snapshot is frozen", async ({ page }) => {
  await mockWorkspace(page, "AWAITING_SIGNATURES");
  await page.goto(`/workspace/agreements/${agreementId}`);
  const terms = page.getByRole("region", { name: "Agreement terms" });
  await expect(terms).toContainText(agreement.serviceDescription);
  await expect(terms).toContainText("Scheduled maintenance");
  await expect(terms).toContainText("24 hours");
  await expect(terms).toContainText(agreement.terms.notes);
  await expect(page.getByText("Review the complete frozen SLA terms")).toHaveCount(0);
});

test("confirmed agreements retain their signed snapshot at mobile and desktop widths", async ({ page }, testInfo) => {
  await mockWorkspace(page);
  await page.goto(`/workspace/agreements/${agreementId}`);
  await expect(page.getByRole("heading", { name: "Frozen version 1" })).toBeVisible();
  await page.getByText("Review the complete frozen SLA terms").click();
  await expect(page.locator("details pre")).toContainText(agreement.serviceDescription);
  await expect(page.getByRole("button", { name: "Sign with connected wallet" })).toHaveCount(0);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `horizontal overflow at ${width}px`).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`confirmed-${width}.png`), fullPage: true });
  }
});

test("agreement pagination reaches older records", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/workspace/agreements");
  await expect(page.getByRole("link", { name: "Recent draft 0", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(page.getByRole("link", { name: agreement.name, exact: true })).toBeVisible();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Previous", exact: true }).click();
  await expect(page.getByRole("link", { name: "Recent draft 0", exact: true })).toBeVisible();
});

test("monitoring includes confirmed agreements after fifty newer drafts", async ({ page }) => {
  await mockWorkspace(page);
  await page.goto("/workspace/monitoring");
  await expect(page.getByLabel("Confirmed agreement")).toHaveValue(agreementId);
  await expect(page.getByRole("heading", { name: "Measurement sources", exact: true })).toBeVisible();
  await expect(page.getByText("Each window keeps its saved result.", { exact: false })).toBeVisible();
});
