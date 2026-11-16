import { expect, type Browser, type Page } from "@playwright/test";

export const PASSWORD = "Wakeel#Dev2026!";
export const USERS = {
  admin: "superadmin@wakeel.test",
  ops: "ops@wakeel.test",
  field: "field@wakeel.test",
  vendor: "vendor@elnexu.test",
};

export async function login(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function newSession(browser: Browser, email: string) {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await login(page, email);
  return { ctx, page };
}

let n = Math.floor(Math.random() * 9000) + 1000;
export function uniqueTerminal() {
  n++;
  const r = Math.floor(Math.random() * 90 + 10);
  return { serial: `E2E${r}${String(Date.now()).slice(-6)}${n}`, tid: `E${r}${String(n).padStart(5, "0")}`.slice(0, 8) };
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}
