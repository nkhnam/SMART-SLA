import { randomUUID } from "node:crypto";
import { expect, test, type Page, type Route } from "@playwright/test";

const password = "Correct-Horse-Battery-92!";

for (const lateStatus of [200, 500]) {
  test(`Monitoring isolates organization and agreement loads from late ${lateStatus} responses`, async ({ page }) => {
    const organizations = ["org-a", "org-b"].map((id) => ({ id, name: id, role: "OWNER", organizationType: "CUSTOMER", createdAt: "2026-01-01T00:00:00Z" }));
    const agreements = ["agreement-a", "agreement-b"].map((id) => ({ id, name: id, reference: id, version: 1, status: "ANCHOR_CONFIRMED", terms: { uptimeTargetPercent: 99, responseTimeTargetMs: 500, measurementWindowHours: 24 } }));
    let pendingAgreements: Route | undefined;
    let pendingSources: Route | undefined;
    let currentSources: Route | undefined;
    const monitoringRequests: string[] = [];
    await page.route("**/api/v1/**", async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      const organization = request.headers()["x-organization-id"];
      if (path.endsWith("/auth/me")) return route.fulfill({ json: { user: { id: "viewer", displayName: "Viewer" } } });
      if (path.endsWith("/organizations")) return route.fulfill({ json: organizations });
      if (path.endsWith("/agreements")) {
        if (organization === "org-a") { pendingAgreements = route; return; }
        return route.fulfill({ json: { data: agreements, total: 2 } });
      }
      if (path.includes("/monitoring/")) {
        monitoringRequests.push(`${organization}:${path}`);
        if (path.includes("agreement-a/monitoring/sources")) { pendingSources = route; return; }
        if (path.endsWith("/sources")) { currentSources = route; return; }
        return route.fulfill({ json: path.endsWith("/observations") ? { data: [], total: 0 } : [] });
      }
      return route.fulfill({ json: [] });
    });
    await page.goto("/workspace/monitoring");
    await expect.poll(() => Boolean(pendingAgreements)).toBe(true);
    await expect(page.getByText("Loading live monitoring data…")).toBeVisible();
    await expect(page.getByRole("heading", { name: "No confirmed agreements" })).toHaveCount(0);
    await page.getByLabel("Live organization").selectOption("org-b");
    await expect.poll(() => Boolean(pendingSources)).toBe(true);
    await expect(page.getByText("Loading live monitoring data…")).toBeVisible();
    await page.getByLabel("Confirmed agreement").selectOption("agreement-b");
    await expect.poll(() => Boolean(currentSources)).toBe(true);
    await expect(page.getByText("Loading live monitoring data…")).toBeVisible();
    const staleAgreements = page.waitForResponse((response) => response.url().includes("/agreements?") && response.request().headers()["x-organization-id"] === "org-a");
    const staleSources = page.waitForResponse((response) => response.url().includes("agreement-a/monitoring/sources"));
    await pendingAgreements!.fulfill({ status: lateStatus, json: lateStatus === 200 ? { data: [], total: 0 } : { error: { message: "Stale agreements error" } } });
    await pendingSources!.fulfill({ status: lateStatus, json: lateStatus === 200 ? [{ id: "stale", name: "Stale source", trustCategory: "OPERATOR_COLLECTED", type: "HTTP_PROBE", intervalSeconds: 300 }] : { error: { message: "Stale monitoring error" } } });
    await Promise.all([staleAgreements, staleSources]);
    await expect(page.getByText("Loading live monitoring data…")).toBeVisible();
    await currentSources!.fulfill({ json: [{ id: "source-b", name: "Current source", type: "HTTP_PROBE", trustCategory: "OPERATOR_COLLECTED", intervalSeconds: 300, enabled: true }] });
    await expect(page.getByLabel("Confirmed agreement")).toHaveValue("agreement-b");
    await expect(page.getByText("Current source", { exact: true })).toBeVisible();
    await expect(page.getByText("Stale source", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    expect(monitoringRequests.every((request) => request.startsWith("org-b:"))).toBe(true);
    const previousSources = currentSources;
    await page.getByRole("button", { name: "Evaluate signed window" }).click();
    await expect.poll(() => currentSources !== previousSources).toBe(true);
    await expect(page.getByText("Loading live monitoring data…")).toBeVisible();
    await currentSources!.fulfill({ json: [] });
    await expect(page.getByText("Loading live monitoring data…")).toHaveCount(0);
    await expect(page.getByText("No sources yet.", { exact: true })).toBeVisible();
  });
}

async function register(page: Page) {
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Synthetic monitoring viewer");
  await page.getByLabel("Email", { exact: true }).fill(`phase2c-${randomUUID()}@example.test`);
  await page.getByLabel(/Password/).fill(password);
  await page.getByLabel("Organization name").fill("Synthetic Phase 2C viewer");
  await page.getByLabel("Organization type").selectOption("CUSTOMER");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByLabel("Live organization")).toContainText("Synthetic Phase 2C viewer");
}

test("Phase 2C live monitoring empty state stays separate from Demo Mode at all required widths", async ({ page }) => {
  const consoleErrors: string[] = [];
  const pageExceptions: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageExceptions.push(error.message));
  await register(page);

  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/workspace/monitoring");
    await expect(page.getByRole("heading", { name: "Live monitoring" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No confirmed agreements" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Demo Mode" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `Live monitoring overflows at ${width}px`).toBe(true);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "SLA-DEX Live workspace" })).toBeFocused();
  }

  await page.getByRole("link", { name: "Demo Mode" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("link", { name: /Live workspace/ })).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageExceptions).toEqual([]);
});
