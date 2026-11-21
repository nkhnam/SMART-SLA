import { createHmac, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";
import type { TypedDataDefinition } from "viem";

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

async function register(page: Page, name = "Synthetic Phase 2C viewer", organizationType = "CUSTOMER") {
  const email = `phase2c-${randomUUID()}@example.test`;
  await page.goto("/register");
  await page.getByLabel("Your name").fill("Synthetic monitoring viewer");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByLabel("Organization name").fill(name);
  await page.getByLabel("Organization type").selectOption(organizationType);
  const registered = page.waitForResponse((response) => response.url().endsWith("/auth/register") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Create account" }).click();
  const response = await registered;
  expect(response.status()).toBe(201);
  const payload = await response.json() as { user: { id: string }; organization: { id: string } };
  await expect(page.getByLabel("Live organization")).toContainText(name);
  return { page, email, userId: payload.user.id, organizationId: payload.organization.id };
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
    await expect(page.getByRole("link", { name: "SMART-SLA Live workspace" })).toBeFocused();
  }

  await page.getByRole("link", { name: "Demo Mode" }).click();
  await expect(page).toHaveURL(/\/overview$/);
  await expect(page.getByRole("link", { name: /Live workspace/ })).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(pageExceptions).toEqual([]);
});

type Actor = Awaited<ReturnType<typeof register>>;
type Source = { id: string; name: string; enabled: boolean; webhookSecret?: string | null; canManage: boolean; trustCategory: string; nextRunAt: string | null };
const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:4000/api/v1";
const browserBase = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
const terms = { name: "SYNTHETIC Gate 3C SLA", serviceDescription: "Authenticated monitoring browser fixture", counterpartyDisplayName: "Synthetic provider", terms: { uptimeTargetPercent: 99, responseTimeTargetMs: 200, measurementWindowHours: 1, exclusions: [] } };

async function api<T>(actor: Actor, path: string, method = "GET", data?: unknown, expected = method === "POST" ? 201 : 200): Promise<T> {
  const response = await actor.page.request.fetch(`${apiBase}${path}`, { method, headers: { origin: browserBase, "x-sla-csrf": "1", "x-organization-id": actor.organizationId }, ...(data === undefined ? {} : { data }) });
  expect(response.status(), `${method} ${path}`).toBe(expected);
  return response.json() as Promise<T>;
}

async function updateTestFixture(sql: string, values: unknown[]) {
  const database = new URL(process.env.DATABASE_URL!);
  expect(["localhost", "127.0.0.1", "[::1]"]).toContain(database.hostname);
  expect(database.pathname).toMatch(/_test$/);
  const { Client } = createRequire(resolve(process.cwd(), "../backend/package.json"))("pg") as { Client: new (options: { connectionString: string }) => { connect(): Promise<void>; query(sql: string, values: unknown[]): Promise<{ rowCount: number }>; end(): Promise<void> } };
  const connection = new Client({ connectionString: database.toString() });
  try {
    await connection.connect();
    const result = await connection.query(sql, values);
    expect(result.rowCount).toBe(1);
  } finally { await connection.end(); }
}

async function changeRole(actor: Actor, role: "OWNER" | "ADMIN" | "MEMBER") {
  await updateTestFixture('UPDATE "Membership" SET "role" = $1::"MembershipRole" WHERE "userId" = $2::uuid AND "organizationId" = $3::uuid', [role, actor.userId, actor.organizationId]);
}

async function seedCompletedWebhookSlot(actor: Actor, source: Source) {
  const observedAt = new Date(Date.now() - 60_000).toISOString();
  // Two missed slots keep coverage insufficient; the third slot is already closed.
  await updateTestFixture('UPDATE "MonitoringSource" SET "createdAt" = $1::timestamptz - (2 * "intervalSeconds") * INTERVAL \'1 second\' WHERE "id" = $2::uuid AND "organizationId" = $3::uuid', [observedAt, source.id, actor.organizationId]);
  return observedAt;
}

type Identities = { customer: Omit<Actor, "page">; provider: Omit<Actor, "page">; outsider: Omit<Actor, "page">; providerState: Awaited<ReturnType<BrowserContext["storageState"]>>; outsiderState: Awaited<ReturnType<BrowserContext["storageState"]>>; signers: string[] };
const monitoringTest = test.extend<{ signed: { customer: Actor; provider: Actor; outsider: Actor; primary: string; secondary: string } }, { identities: Identities }>({
  identities: [async ({ browser }, provide) => {
    expect(["localhost", "127.0.0.1"]).toContain(new URL(apiBase).hostname);
    expect(new URL(process.env.DATABASE_URL!).pathname).toMatch(/_test$/);
    const customerContext = await browser.newContext({ baseURL: browserBase });
    const providerContext = await browser.newContext({ baseURL: browserBase });
    const outsiderContext = await browser.newContext({ baseURL: browserBase });
    let prepared: Identities;
    try {
      const customer = await register(await customerContext.newPage(), "Synthetic monitoring customer");
      const provider = await register(await providerContext.newPage(), "Synthetic monitoring provider", "PROVIDER");
      const outsider = await register(await outsiderContext.newPage(), "Synthetic unrelated organization");
      const signers: string[] = [];
      for (const [actor, key] of [[customer, `0x${"11".repeat(32)}`], [provider, `0x${"22".repeat(32)}`]] as const) {
        const account = privateKeyToAccount(key);
        const challenge = await api<{ challengeId: string; typedData: TypedDataDefinition }>(actor, "/organizations/signers/challenge", "POST", { address: account.address });
        const signer = await api<{ id: string }>(actor, "/organizations/signers/verify", "POST", { challengeId: challenge.challengeId, signature: await account.signTypedData(challenge.typedData) });
        signers.push(signer.id);
      }
      const identity = (actor: Actor) => ({ email: actor.email, userId: actor.userId, organizationId: actor.organizationId });
      prepared = { customer: identity(customer), provider: identity(provider), outsider: identity(outsider), providerState: await providerContext.storageState(), outsiderState: await outsiderContext.storageState(), signers };
    } finally { await customerContext.close(); await providerContext.close(); await outsiderContext.close(); }
    await provide(prepared);
  }, { scope: "worker" }],
  signed: async ({ page, browser, identities }, provide) => {
    const providerContext = await browser.newContext({ baseURL: browserBase, storageState: identities.providerState });
    const outsiderContext = await browser.newContext({ baseURL: browserBase, storageState: identities.outsiderState });
    try {
      await page.goto("/login");
      await page.getByLabel("Email", { exact: true }).fill(identities.customer.email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(/\/workspace\/agreements$/);
      const customer = { ...identities.customer, page };
      const provider = { ...identities.provider, page: await providerContext.newPage() };
      const outsider = { ...identities.outsider, page: await outsiderContext.newPage() };
      const agreements: string[] = [];
      for (const label of ["primary", "secondary"]) {
        const agreement = await api<{ id: string }>(customer, "/agreements", "POST", { ...terms, name: `${terms.name} ${label} ${randomUUID().slice(0, 8)}` });
        const path = `/agreements/${agreement.id}`;
        const invitation = await api<{ id: string }>(customer, `${path}/invitations`, "POST", { organizationId: provider.organizationId });
        await api(provider, `${path}/invitations/${invitation.id}/accept`, "POST");
        for (const [index, actor] of [customer, provider].entries()) await api(actor, `${path}/signers`, "POST", { authorizedSignerId: identities.signers[index] });
        const snapshot = await api<{ typedData: TypedDataDefinition }>(customer, `${path}/signing/prepare`, "POST");
        expect(Number(snapshot.typedData.domain?.chainId)).toBe(31337);
        for (const [actor, key] of [[customer, `0x${"11".repeat(32)}`], [provider, `0x${"22".repeat(32)}`]] as const) await api(actor, `${path}/signatures`, "POST", { signature: await privateKeyToAccount(key).signTypedData(snapshot.typedData) });
        agreements.push(agreement.id);
      }
      await expect.poll(async () => Promise.all(agreements.map(async (id) => (await api<{ status: string }>(customer, `/agreements/${id}`)).status)), { timeout: 45_000, intervals: [1_000, 5_000] }).toEqual(["ANCHOR_CONFIRMED", "ANCHOR_CONFIRMED"]);
      await provide({ customer, provider, outsider, primary: agreements[0], secondary: agreements[1] });
    } finally { await providerContext.close(); await outsiderContext.close(); }
  }
});

monitoringTest.setTimeout(120_000);

async function openMonitoring(actor: Actor, agreementId: string) {
  await actor.page.goto("/workspace/monitoring");
  await expect(actor.page.getByLabel("Confirmed agreement")).toBeVisible();
  await actor.page.getByLabel("Confirmed agreement").selectOption(agreementId);
  await expect(actor.page.getByText("Loading live monitoring data…")).toHaveCount(0);
}

async function addWebhook(actor: Actor, agreementId: string, name: string): Promise<Source> {
  await actor.page.getByLabel("Source type").selectOption("SIGNED_WEBHOOK");
  await actor.page.getByLabel("Source name").fill(name);
  const created = actor.page.waitForResponse((response) => response.url().endsWith(`/agreements/${agreementId}/monitoring/sources`) && response.request().method() === "POST");
  await actor.page.getByRole("button", { name: "Add source", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const source = await response.json() as Source;
  const notice = actor.page.getByRole("status").filter({ hasText: "Copy this one-time webhook secret now" });
  await expect(notice).toBeVisible();
  expect((await notice.innerText()).includes(source.webhookSecret!)).toBe(true);
  await expect(sourceCard(actor.page, name)).toBeVisible();
  return source;
}

function sourceCard(page: Page, name: string) { return page.getByRole("article").filter({ has: page.getByText(name, { exact: true }) }); }

async function sourceAction(actor: Actor, agreementId: string, source: Source, action: string) {
  const updated = actor.page.waitForResponse((response) => response.url().endsWith(`/agreements/${agreementId}/monitoring/sources/${source.id}`) && response.request().method() === "PATCH");
  await sourceCard(actor.page, source.name).getByRole("button", { name: action, exact: true }).click();
  const response = await updated;
  expect(response.status()).toBe(200);
  await expect(actor.page.getByText("Loading live monitoring data…")).toHaveCount(0);
  return response.json() as Promise<Source>;
}

async function webhook(actor: Actor, source: Source, secret: string, expected = 201, observedAt = new Date().toISOString()) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID();
  const eventId = randomUUID();
  const body = JSON.stringify({ observedAt, reachable: true, httpStatus: 200, latencyMs: 100, agentIdentity: "synthetic-gate3c-browser", providerMetadata: { synthetic: true, independentMeasurement: false } });
  const signature = `v1=${createHmac("sha256", secret).update(`${timestamp}.${nonce}.${eventId}.`).update(body).digest("hex")}`;
  const response = await actor.page.request.post(`${apiBase}/monitoring/webhooks/${source.id}`, { headers: { "content-type": "application/json", "x-monitoring-timestamp": timestamp, "x-monitoring-nonce": nonce, "x-monitoring-event-id": eventId, "x-monitoring-signature": signature }, data: body });
  expect(response.status()).toBe(expected);
  return response.json();
}

monitoringTest("Gate 3C owner manages a persistent webhook, evaluates unknown coverage and exports evidence", async ({ signed }) => {
  const { customer, primary } = signed;
  const exceptions: string[] = [];
  customer.page.on("pageerror", (error) => exceptions.push(error.message));
  await customer.page.setViewportSize({ width: 1440, height: 900 });
  await openMonitoring(customer, primary);
  const source = await addWebhook(customer, primary, "SYNTHETIC lifecycle source");
  await api(customer, `/agreements/${primary}/monitoring/sources/${source.id}`, "PATCH", { enabled: null }, 400);
  expect((await sourceAction(customer, primary, source, "Pause")).enabled).toBe(false);
  await expect(sourceCard(customer.page, source.name)).toContainText("paused");
  await webhook(customer, source, source.webhookSecret!, 404);
  await openMonitoring(customer, primary);
  await expect(sourceCard(customer.page, source.name).getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  expect((await customer.page.locator("body").innerText()).includes(source.webhookSecret!)).toBe(false);
  expect((await sourceAction(customer, primary, source, "Resume")).enabled).toBe(true);
  const rotated = await sourceAction(customer, primary, source, "Rotate secret");
  expect(/^[a-f0-9]{64}$/.test(rotated.webhookSecret ?? "")).toBe(true);
  expect(rotated.webhookSecret !== source.webhookSecret).toBe(true);
  const rotationNotice = customer.page.getByRole("status").filter({ hasText: "New webhook secret" });
  await expect(rotationNotice).toBeVisible();
  expect((await rotationNotice.innerText()).includes(rotated.webhookSecret!)).toBe(true);
  await webhook(customer, source, source.webhookSecret!, 403);
  const observedAt = await seedCompletedWebhookSlot(customer, source);
  const ingested = await webhook(customer, source, rotated.webhookSecret!, 201, observedAt) as { observationId: string };
  await openMonitoring(customer, primary);
  const rows = customer.page.getByRole("row").filter({ hasText: source.name });
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText("PROVIDER REPORTED");
  await expect(rows).toContainText("VALID");
  const listed = await api<Source[]>(customer, `/agreements/${primary}/monitoring/sources`);
  expect(listed[0].webhookSecret).toBeUndefined();
  await api(customer, `/agreements/${primary}/monitoring/observations?page=0&pageSize=201`, "GET", undefined, 400);
  expect((await customer.page.locator("body").innerText()).includes(rotated.webhookSecret!)).toBe(false);
  const evaluated = customer.page.waitForResponse((response) => response.url().endsWith(`/agreements/${primary}/monitoring/kpis/evaluate`));
  await customer.page.getByRole("button", { name: "Evaluate signed window" }).click();
  const evaluation = await evaluated;
  expect(evaluation.status()).toBe(201);
  expect(await evaluation.json()).toMatchObject({ data: [{ state: "INSUFFICIENT_DATA", uptimePercent: null, expectedSamples: 3, healthyObservations: 1, unknownObservations: 2 }] });
  await expect(customer.page.getByText(/Uptime unknown/)).toBeVisible();
  await expect(customer.page.getByText("No breach candidates recorded.")).toBeVisible();
  await customer.page.getByRole("button", { name: "Build evidence", exact: true }).click();
  await expect(customer.page.getByText("Version 1 · 1 observations")).toBeVisible();
  const downloaded = customer.page.waitForEvent("download");
  await customer.page.getByRole("button", { name: "Export & verify" }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toMatch(/^sla-dex-evidence-[a-f0-9-]+\.json$/);
  const stream = await download.createReadStream();
  expect(stream).not.toBeNull();
  let bytes = "";
  for await (const chunk of stream!) bytes += chunk.toString();
  const exported = JSON.parse(bytes);
  expect(exported.manifest).toMatchObject({ agreementId: primary, agreementVersion: 1, observationCount: 1 });
  expect(exported.records[0].record.id).toBe(ingested.observationId);
  expect(exported.verification.valid).toBe(true);
  await expect(customer.page.getByText("Integrity check passed", { exact: true })).toBeVisible();
  await customer.page.getByRole("button", { name: "Sign out" }).click();
  await expect(customer.page).toHaveURL(/\/login$/);
  await api(customer, `/agreements/${primary}/monitoring/sources`, "GET", undefined, 401);
  await customer.page.goto("/workspace/monitoring");
  await expect(customer.page.getByRole("heading", { name: "Sign in to your live workspace" })).toBeVisible();
  await expect(customer.page.getByText(source.name, { exact: true })).toHaveCount(0);
  expect(exceptions).toEqual([]);
});

monitoringTest("Gate 3C authenticated source notices and agreement switching fit all required widths", async ({ signed }, testInfo) => {
  const { customer, primary, secondary } = signed;
  for (const width of [375, 768, 1440]) {
    await customer.page.setViewportSize({ width, height: 900 });
    await openMonitoring(customer, primary);
    const source = await addWebhook(customer, primary, `SYNTHETIC responsive source ${width}`);
    const overflow = await customer.page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll("body *")].filter((element) => element.getBoundingClientRect().right > document.documentElement.clientWidth).slice(0, 12).map((element) => ({ tag: element.tagName, classes: element.className, right: element.getBoundingClientRect().right }))
    }));
    expect(overflow.scrollWidth <= overflow.width, `Authenticated monitoring overflows at ${width}px: ${JSON.stringify(overflow)}`).toBe(true);
    await customer.page.screenshot({ path: testInfo.outputPath(`monitoring-${width}.png`), fullPage: true, mask: [customer.page.getByRole("status")] });
    await customer.page.getByLabel("Confirmed agreement").selectOption(secondary);
    await expect(customer.page.getByText("No sources yet.", { exact: true })).toBeVisible();
    await expect(customer.page.getByText(source.name, { exact: true })).toHaveCount(0);
    expect((await customer.page.locator("body").innerText()).includes(source.webhookSecret!)).toBe(false);
    await customer.page.getByLabel("Confirmed agreement").selectOption(primary);
    await expect(sourceCard(customer.page, source.name)).toBeVisible();
    expect((await customer.page.locator("body").innerText()).includes(source.webhookSecret!)).toBe(false);
  }
});

monitoringTest("Gate 3C source management enforces owner, administrator, member and organization boundaries", async ({ signed }) => {
  const { customer, provider, outsider, primary } = signed;
  const path = `/agreements/${primary}/monitoring/sources`;
  const source = await api<Source>(customer, path, "POST", { type: "SIGNED_WEBHOOK", name: "SYNTHETIC access-bound source", intervalSeconds: 300 });
  await openMonitoring(provider, primary);
  await expect(sourceCard(provider.page, source.name)).toBeVisible();
  await expect(sourceCard(provider.page, source.name).getByRole("button")).toHaveCount(0);
  const shared = await api<Source[]>(provider, path);
  expect(shared[0].canManage).toBe(false);
  expect(shared[0].webhookSecret).toBeUndefined();
  await api(provider, `${path}/${source.id}`, "PATCH", { enabled: false }, 404);
  await api(outsider, path, "GET", undefined, 404);
  await api(outsider, path, "POST", { type: "SIGNED_WEBHOOK", name: "forbidden", intervalSeconds: 300 }, 404);
  await outsider.page.goto("/workspace/monitoring");
  await expect(outsider.page.getByRole("heading", { name: "No confirmed agreements" })).toBeVisible();
  try {
    await changeRole(customer, "MEMBER");
    await openMonitoring(customer, primary);
    await expect(customer.page.getByRole("heading", { name: "Add monitoring source" })).toHaveCount(0);
    await expect(sourceCard(customer.page, source.name).getByRole("button")).toHaveCount(0);
    await api(customer, path, "POST", { type: "SIGNED_WEBHOOK", name: "forbidden", intervalSeconds: 300 }, 403);
    await api(customer, `${path}/${source.id}`, "PATCH", { rotateWebhookSecret: true }, 403);
    await changeRole(customer, "ADMIN");
    await openMonitoring(customer, primary);
    await expect(customer.page.getByRole("heading", { name: "Add monitoring source" })).toBeVisible();
    expect((await api<Source[]>(customer, path))[0].canManage).toBe(true);
    expect((await sourceAction(customer, primary, source, "Pause")).enabled).toBe(false);
    expect((await sourceAction(customer, primary, source, "Resume")).enabled).toBe(true);
    await addWebhook(customer, primary, "SYNTHETIC administrator source");
  } finally { await changeRole(customer, "OWNER"); }

  const paused = await addWebhook(provider, primary, "SYNTHETIC quota-paused source");
  expect((await sourceAction(provider, primary, paused, "Pause")).enabled).toBe(false);
  const active: Source[] = [];
  for (let index = 0; index < 20; index++) active.push(await api<Source>(provider, path, "POST", { type: "SIGNED_WEBHOOK", name: `SYNTHETIC quota source ${index}`, intervalSeconds: 300 }));
  await api(provider, `${path}/${paused.id}`, "PATCH", { enabled: true }, 409);
  expect((await api<Source>(provider, `${path}/${active[0].id}`, "PATCH", { enabled: true })).enabled).toBe(true);
  await api(provider, `${path}/${active[0].id}`, "PATCH", { enabled: false });
  const headers = { origin: browserBase, "x-sla-csrf": "1", "x-organization-id": provider.organizationId };
  const contenders = await Promise.all([
    provider.page.request.patch(`${apiBase}${path}/${paused.id}`, { headers, data: { enabled: true } }),
    provider.page.request.post(`${apiBase}${path}`, { headers, data: { type: "SIGNED_WEBHOOK", name: "SYNTHETIC concurrent quota source", intervalSeconds: 300 } })
  ]);
  const statuses = contenders.map((response) => response.status());
  expect(statuses.filter((status) => status === 409)).toHaveLength(1);
  expect(statuses.filter((status) => status === 200 || status === 201)).toHaveLength(1);
  const quotaSources = await api<Source[]>(provider, path);
  expect(quotaSources.filter((item) => item.canManage && item.enabled)).toHaveLength(20);
  const enabled = quotaSources.find((item) => item.canManage && item.enabled)!;
  await api(provider, `${path}/${enabled.id}`, "PATCH", { enabled: true });
});

monitoringTest("Gate 3C rejects restricted endpoints and hides sources after an unsigned amendment", async ({ signed }) => {
  const { customer, primary, secondary } = signed;
  await openMonitoring(customer, primary);
  await customer.page.getByLabel("Source type").selectOption("HTTP_PROBE");
  await customer.page.getByLabel("Source name").fill("SYNTHETIC rejected probe");
  await customer.page.getByLabel("Public HTTP or HTTPS endpoint").fill("http://127.0.0.1/");
  const rejected = customer.page.waitForResponse((response) => response.url().endsWith(`/agreements/${primary}/monitoring/sources`) && response.request().method() === "POST");
  await customer.page.getByRole("button", { name: "Add source", exact: true }).click();
  expect((await rejected).status()).toBe(400);
  await expect(customer.page.getByRole("main").getByRole("alert")).toContainText("publicly routable");
  expect(await api<Source[]>(customer, `/agreements/${primary}/monitoring/sources`)).toEqual([]);
  const source = await addWebhook(customer, primary, "SYNTHETIC version-one source");
  await webhook(customer, source, source.webhookSecret!);
  await api(customer, `/agreements/${primary}/amend`, "POST", { ...terms, expectedVersion: 1, name: "SYNTHETIC unsigned version two" });
  await customer.page.reload();
  await expect(customer.page.getByLabel("Confirmed agreement")).toHaveValue(secondary);
  await expect(customer.page.getByLabel("Confirmed agreement").locator(`option[value="${primary}"]`)).toHaveCount(0);
  await expect(customer.page.getByText(source.name, { exact: true })).toHaveCount(0);
  await api(customer, `/agreements/${primary}/monitoring/sources`, "GET", undefined, 409);
  await api(customer, `/agreements/${primary}/monitoring/sources/${source.id}`, "PATCH", { enabled: false }, 409);
  const history = await api<{ data: Array<{ agreementVersion: number; source: { name: string } }> }>(customer, `/agreements/${primary}/monitoring/observations`);
  expect(history.data).toHaveLength(1);
  expect(history.data[0]).toMatchObject({ agreementVersion: 1, source: { name: source.name } });
});
