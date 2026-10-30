import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { privateKeyToAccount } from "viem/accounts";

const buyerPrivateKey = `0x${"11".repeat(32)}` as `0x${string}`;
const supplierPrivateKey = `0x${"22".repeat(32)}` as `0x${string}`;
const buyerWallet = privateKeyToAccount(buyerPrivateKey);
const supplierWallet = privateKeyToAccount(supplierPrivateKey);
const unrelatedWallet = privateKeyToAccount(`0x${"44".repeat(32)}`);
const password = "Correct-Horse-Battery-92!";
const chainId = 31337;

async function installWallet(page: Page, address: string, privateKey: `0x${string}`) {
  await page.exposeFunction("__signTestTypedData", async (payload: { address: string; typedData: string }) => {
    assert.equal(payload.address.toLowerCase(), address.toLowerCase());
    return privateKeyToAccount(privateKey).signTypedData(JSON.parse(payload.typedData));
  });
  await page.addInitScript(({ initialAddress, localChainId }) => {
    let account = initialAddress;
    let currentChain = "0x1";
    let rejectNextSignature = false;
    let rejectSwitch = false;
    let switchCount = 0;
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    const emit = (event: string, ...args: unknown[]) => listeners.get(event)?.forEach((listener) => listener(...args));
    const provider = {
      request: async ({ method, params = [] }: { method: string; params?: unknown[] }) => {
        if (method === "eth_chainId") return currentChain;
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [account];
        if (method === "wallet_switchEthereumChain") {
          if (rejectSwitch) throw Object.assign(new Error("User rejected network switch"), { code: 4001 });
          currentChain = (params[0] as { chainId: string }).chainId;
          switchCount += 1;
          emit("chainChanged", currentChain);
          return null;
        }
        if (method === "eth_signTypedData_v4") {
          if (rejectNextSignature) { rejectNextSignature = false; throw Object.assign(new Error("User rejected signing request"), { code: 4001 }); }
          return (window as unknown as { __signTestTypedData: (data: { address: string; typedData: string }) => Promise<string> }).__signTestTypedData({ address: String(params[0]), typedData: String(params[1]) });
        }
        throw new Error(`Unsupported test wallet request: ${method}`);
      },
      on: (event: string, listener: (...args: unknown[]) => void) => { const handlers = listeners.get(event) ?? new Set(); handlers.add(listener); listeners.set(event, handlers); },
      removeListener: (event: string, listener: (...args: unknown[]) => void) => listeners.get(event)?.delete(listener)
    };
    Object.assign(window, {
      ethereum: provider,
      __configureTestWallet: (options: { rejectNextSignature?: boolean; rejectSwitch?: boolean }) => { rejectNextSignature = options.rejectNextSignature ?? false; rejectSwitch = options.rejectSwitch ?? false; },
      __setTestAccount: (next: string) => { account = next; emit("accountsChanged", [next]); },
      __walletSwitchCount: () => switchCount,
      __localChainId: localChainId
    });
  }, { initialAddress: address, localChainId: chainId });
}

async function register(page: Page, suffix: string, organizationType: "CUSTOMER" | "PROVIDER") {
  const email = `${suffix}-${randomUUID()}@example.test`;
  await page.goto("/register");
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/auth/register") && response.request().method() === "POST");
  await page.getByLabel("Your name").fill(`Test ${suffix}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByLabel("Organization name").fill(`Test Organization ${suffix}`);
  await page.getByLabel("Organization type").selectOption(organizationType);
  await page.getByRole("button", { name: "Create account" }).click();
  const response = await responsePromise;
  const payload = await response.json() as { organization: { id: string } };
  await expect(page.getByLabel("Live organization")).toContainText(`Test Organization ${suffix}`);
  return { email, organizationId: payload.organization.id };
}

test("live SLA signing, wallet recovery, isolation, and responsive layouts", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const consoleErrors: string[] = [];
  const pageExceptions: string[] = [];
  const clientFailures: Array<{ method: string; path: string; status: number }> = [];
  const captureClientFailures = (target: Page) => target.on("response", (response) => {
    if (response.status() === 404 || response.status() === 409) clientFailures.push({ method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() });
  });
  for (const target of [page]) {
    target.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
    target.on("pageerror", (error) => pageExceptions.push(error.message));
    captureClientFailures(target);
  }
  const customer = await register(page, "buyer", "CUSTOMER");
  const providerContext = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  const providerPage = await providerContext.newPage();
  providerPage.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  providerPage.on("pageerror", (error) => pageExceptions.push(error.message));
  captureClientFailures(providerPage);
  const provider = await register(providerPage, "supplier", "PROVIDER");

  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(customer.email);
  await page.getByLabel(/Password/).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByLabel("Live organization")).toContainText("Test Organization buyer");

  await page.goto("/workspace/agreements/new");
  await page.getByLabel("Agreement name").fill("E2E editable uptime draft");
  await page.getByLabel("Service description").fill("Browser-driven local SLA for a test organization");
  await page.getByLabel(/Counterparty display name/).fill("Test Supplier LLC");
  await page.getByLabel(/Uptime target/).fill("99.95");
  await page.getByLabel(/Response target/).fill("180");
  await page.getByLabel(/Measurement window/).fill("24");
  await page.getByLabel(/Exclusions/).fill("Scheduled maintenance");
  const createPromise = page.waitForResponse((response) => response.url().endsWith("/agreements") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save draft" }).click();
  const created = await createPromise;
  const agreement = await created.json() as { id: string };
  await expect(page.getByRole("heading", { name: "Agreement workflow" })).toBeVisible();
  await page.getByLabel("Agreement name").fill("E2E frozen uptime agreement");
  const editPromise = page.waitForResponse((response) => response.url().endsWith(`/agreements/${agreement.id}`) && response.request().method() === "PATCH");
  await page.getByRole("button", { name: "Save draft" }).click();
  await editPromise;
  await expect(page.getByRole("heading", { name: "E2E frozen uptime agreement" })).toBeVisible();

  await page.getByPlaceholder("Counterparty organization UUID").fill(provider.organizationId);
  const invitationPromise = page.waitForResponse((response) => response.url().includes(`/agreements/${agreement.id}/invitations`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send invitation" }).click();
  const invitationResponse = await invitationPromise;
  expect(invitationResponse.status()).toBe(201);
  await expect(page.getByText("Invitation sent.")).toBeVisible();

  await providerPage.reload();
  await expect(providerPage.getByRole("heading", { name: "Invitations" })).toBeVisible();
  await expect(providerPage.getByText("E2E frozen uptime agreement")).toHaveCount(0);
  await providerPage.getByRole("button", { name: "Accept" }).click();
  await expect(providerPage.getByRole("heading", { name: "E2E frozen uptime agreement" })).toBeVisible();
  await expect(providerPage.getByText("Review the complete frozen SLA terms")).toHaveCount(0);
  await expect(providerPage.getByRole("heading", { name: "Agreement workflow" })).toBeVisible();

  await installWallet(page, buyerWallet.address, buyerPrivateKey);
  await installWallet(providerPage, supplierWallet.address, supplierPrivateKey);
  await page.reload();
  await providerPage.reload();

  await page.evaluate(() => (window as unknown as { __configureTestWallet: (options: { rejectSwitch?: boolean }) => void }).__configureTestWallet({ rejectSwitch: true }));
  await page.getByRole("button", { name: "Connect and verify wallet" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("Switch your wallet to chain 31337");
  await page.evaluate(() => (window as unknown as { __configureTestWallet: (options: { rejectSwitch?: boolean; rejectNextSignature?: boolean }) => void }).__configureTestWallet({ rejectNextSignature: true }));
  await page.getByRole("button", { name: "Connect and verify wallet" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("User rejected signing request");
  await page.getByRole("button", { name: "Connect and verify wallet" }).click();
  await expect(page.getByRole("status")).toContainText("Wallet ownership verified");
  expect(await page.evaluate(() => (window as unknown as { __walletSwitchCount: () => number }).__walletSwitchCount())).toBe(1);
  await page.getByRole("button", { name: "Select signer" }).click();
  await providerPage.getByRole("button", { name: "Connect and verify wallet" }).click();
  await providerPage.getByRole("button", { name: "Select signer" }).click();

  const snapshotPromise = page.waitForResponse((response) => response.url().endsWith(`/agreements/${agreement.id}/signing/prepare`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Freeze version for signing" }).click();
  const snapshotResponse = await snapshotPromise;
  const snapshotBody = await snapshotResponse.text();
  expect(snapshotResponse.ok(), `signing snapshot preparation returned ${snapshotResponse.status()}: ${snapshotBody}`).toBe(true);
  const snapshotPayload = JSON.parse(snapshotBody) as { snapshot: { serviceDescription: string } };
  expect(snapshotPayload.snapshot.serviceDescription).toBe("Browser-driven local SLA for a test organization");
  await expect(page.getByRole("heading", { name: "Frozen version 2" })).toBeVisible();
  await expect(page.getByText("Review the complete frozen SLA terms")).toBeVisible();
  await providerPage.reload();
  await expect(providerPage.getByRole("heading", { name: "Frozen version 2" })).toBeVisible();
  await providerPage.getByText("Review the complete frozen SLA terms").click();
  await expect(providerPage.getByText("Browser-driven local SLA for a test organization")).toBeVisible();

  await page.evaluate(() => (window as unknown as { __configureTestWallet: (options: { rejectNextSignature?: boolean }) => void }).__configureTestWallet({ rejectNextSignature: true }));
  await page.getByRole("button", { name: "Sign with connected wallet" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("User rejected signing request");
  await page.evaluate((wrongAddress) => (window as unknown as { __setTestAccount: (address: string) => void }).__setTestAccount(wrongAddress), unrelatedWallet.address);
  await page.getByRole("button", { name: "Sign with connected wallet" }).click();
  await expect(page.locator('p[role="alert"]')).toContainText("does not match either wallet frozen into this agreement");
  await page.evaluate((address) => (window as unknown as { __setTestAccount: (address: string) => void }).__setTestAccount(address), buyerWallet.address);
  await expect(page.getByText(`Connected ${buyerWallet.address.slice(0, 8)}`)).toBeVisible();
  await page.getByRole("button", { name: "Sign with connected wallet" }).click();
  await expect(page.getByRole("status")).toContainText("Signature submitted");
  const duplicateSignatureResponse = page.waitForResponse((response) => response.url().endsWith(`/agreements/${agreement.id}/signatures`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Sign with connected wallet" }).click();
  const duplicateSignature = await duplicateSignatureResponse;
  expect(duplicateSignature.status()).toBe(409);
  expect(await duplicateSignature.json()).toMatchObject({ error: { code: "ConflictException", message: "A signature for this organization was already recorded." }, path: `/api/v1/agreements/${agreement.id}/signatures` });
  await expect(page.locator('p[role="alert"]')).toContainText("A signature for this organization was already recorded");
  await providerPage.reload();
  await page.request.post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 1, method: "evm_setAutomine", params: [false] } });
  await providerPage.getByRole("button", { name: "Sign with connected wallet" }).click();
  await expect(providerPage.getByRole("status")).toContainText("Signature submitted");
  let failedAnchorDiagnostic: string | null = null;
  await expect.poll(async () => {
    const response = await page.request.get(`http://127.0.0.1:4000/api/v1/agreements/${agreement.id}/anchor`, { headers: { "x-organization-id": customer.organizationId } });
    if (!response.ok()) return `HTTP ${response.status()}: ${await response.text()}`;
    const anchor = await response.json() as { blockchainStatus: string; anchor: { lastError: string | null; transactionHash: string | null } | null };
    if (anchor.blockchainStatus === "FAILED") {
      if (failedAnchorDiagnostic) return failedAnchorDiagnostic;
      const details = `${anchor.anchor?.lastError ?? "no anchor intent"}:hash=${anchor.anchor?.transactionHash ?? "none"}`;
      if (anchor.anchor?.transactionHash) {
        const traceResponse = await page.request.post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 3, method: "debug_traceTransaction", params: [anchor.anchor.transactionHash, { disableStack: true, disableMemory: true, disableStorage: true }] }, timeout: 5_000 });
        const trace = await traceResponse.json() as { result?: { returnValue?: string }; error?: { message: string } };
        failedAnchorDiagnostic = `FAILED:${details}:${trace.result?.returnValue ?? trace.error?.message ?? "trace unavailable"}`;
        return failedAnchorDiagnostic;
      }
      failedAnchorDiagnostic = `FAILED:${details}`;
      return failedAnchorDiagnostic;
    }
    return anchor.blockchainStatus;
  }, { timeout: 35_000 }).toBe("SUBMITTED");
  await page.reload();
  await expect(page.getByText("SUBMITTED", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.request.post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 2, method: "evm_mine", params: [] } });
  await expect(page.getByText("CONFIRMED", { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.request.post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 3, method: "evm_setAutomine", params: [true] } });

  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/workspace/agreements/${agreement.id}`);
    await expect(page.getByRole("heading", { name: "E2E frozen uptime agreement" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Live workspace navigation" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `horizontal overflow at ${width}px`).toBe(true);
  }
  await page.goto("/overview");
  await expect(page.getByRole("link", { name: /Live workspace/ })).toBeVisible();
  await expect(page.getByText("E2E frozen uptime agreement", { exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), "Demo Mode overflows at desktop width").toBe(true);
  expect(consoleErrors).toEqual(["Failed to load resource: the server responded with a status of 409 (Conflict)"]);
  expect(clientFailures).toEqual([{ method: "POST", path: `/api/v1/agreements/${agreement.id}/signatures`, status: 409 }]);
  expect(pageExceptions).toEqual([]);
  await providerContext.close();
  expect(customer.organizationId).toMatch(/^[0-9a-f-]{36}$/i);
});

test("expired signing authorization is rejected after successful invitation acceptance", async ({ browser, page }) => {
  test.setTimeout(180_000);
  const consoleErrors: string[] = [];
  const pageExceptions: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("pageerror", (error) => pageExceptions.push(error.message));
  const customer = await register(page, "expired-buyer", "CUSTOMER");
  const providerContext = await browser.newContext({ baseURL: "http://127.0.0.1:3000" });
  const providerPage = await providerContext.newPage();
  providerPage.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  providerPage.on("pageerror", (error) => pageExceptions.push(error.message));
  const provider = await register(providerPage, "expired-supplier", "PROVIDER");
  await installWallet(page, buyerWallet.address, buyerPrivateKey);
  await installWallet(providerPage, supplierWallet.address, supplierPrivateKey);
  await page.reload();
  await providerPage.reload();

  await page.goto("/workspace/agreements/new");
  await page.getByLabel("Agreement name").fill("E2E expired anchor agreement");
  await page.getByLabel("Service description").fill("Expired only in the local EVM test clock");
  await page.getByLabel(/Counterparty display name/).fill("Test Supplier LLC");
  await page.getByLabel(/Uptime target/).fill("99.95");
  await page.getByLabel(/Response target/).fill("180");
  await page.getByLabel(/Measurement window/).fill("24");
  await page.getByLabel(/Exclusions/).fill("Scheduled maintenance");
  const createPromise = page.waitForResponse((response) => response.url().endsWith("/agreements") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save draft" }).click();
  const agreement = await (await createPromise).json() as { id: string };
  await page.getByPlaceholder("Counterparty organization UUID").fill(provider.organizationId);
  const invitationPromise = page.waitForResponse((response) => response.url().includes(`/agreements/${agreement.id}/invitations`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Send invitation" }).click();
  const invitationResponse = await invitationPromise;
  expect(invitationResponse.status()).toBe(201);
  const invitation = await invitationResponse.json() as { id: string };

  await providerPage.goto("/workspace/agreements");
  await expect(providerPage.getByRole("heading", { name: "Invitations" })).toBeVisible();
  await expect(providerPage.getByText("E2E expired anchor agreement")).toHaveCount(0);
  const acceptancePath = `/api/v1/agreements/${agreement.id}/invitations/${invitation.id}/accept`;
  const acceptancePromise = providerPage.waitForResponse((response) => response.url().endsWith(acceptancePath) && response.request().method() === "POST");
  await providerPage.getByRole("button", { name: "Accept" }).click();
  const acceptanceResponse = await acceptancePromise;
  expect(acceptanceResponse.status()).toBe(201);
  const acceptance = await acceptanceResponse.json() as { id: string; status: string; version: number };
  expect(acceptance).toMatchObject({ id: invitation.id, status: "ACCEPTED", version: 1 });
  await expect(providerPage).toHaveURL(new RegExp(`/workspace/agreements/${agreement.id}$`));
  await expect(providerPage.getByRole("heading", { name: "E2E expired anchor agreement" })).toBeVisible();
  await expect(providerPage.getByText("SUPPLIER: Test Organization expired-supplier")).toBeVisible();
  await expect(providerPage.getByRole("heading", { name: "Authorize the organization signer" })).toBeVisible();
  await expect(providerPage.getByRole("button", { name: "Select signer" })).toHaveCount(0);

  await page.reload();
  await expect(page.getByText("AWAITING SIGNATURES", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Connect and verify wallet" }).click();
  await expect(page.getByRole("status")).toContainText("Wallet ownership verified");
  await providerPage.getByRole("button", { name: "Connect and verify wallet" }).click();
  await expect(providerPage.getByRole("status")).toContainText("Wallet ownership verified");
  await expect(providerPage.getByRole("button", { name: "Select signer" })).toBeVisible();
  await page.getByRole("button", { name: "Select signer" }).click();
  await providerPage.getByRole("button", { name: "Select signer" }).click();
  await page.getByRole("button", { name: "Freeze version for signing" }).click();
  await expect(page.getByRole("heading", { name: "Frozen version 1" })).toBeVisible();
  await providerPage.reload();
  await expect(providerPage.getByRole("heading", { name: "Frozen version 1" })).toBeVisible();
  await providerPage.getByText("Review the complete frozen SLA terms").click();
  await expect(providerPage.getByText("Expired only in the local EVM test clock")).toBeVisible();
  await page.request.post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 1, method: "evm_increaseTime", params: [8 * 24 * 60 * 60] } });
  await page.request.post("http://127.0.0.1:8545", { data: { jsonrpc: "2.0", id: 2, method: "evm_mine", params: [] } });
  await page.getByRole("button", { name: "Sign with connected wallet" }).click();
  await expect(page.getByRole("status")).toContainText("Signature submitted");
  await providerPage.reload();
  await providerPage.getByRole("button", { name: "Sign with connected wallet" }).click();
  await expect(providerPage.getByRole("status")).toContainText("Signature submitted");
  await expect(page.getByText("FAILED", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('p[role="alert"]')).toContainText("Anchor error");
  expect(consoleErrors).toEqual([]);
  expect(pageExceptions).toEqual([]);
  await providerContext.close();
  expect(customer.organizationId).toMatch(/^[0-9a-f-]{36}$/i);
});
