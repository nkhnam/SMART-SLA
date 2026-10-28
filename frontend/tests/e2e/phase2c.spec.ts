import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

const password = "Correct-Horse-Battery-92!";

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
