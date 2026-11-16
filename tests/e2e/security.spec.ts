import { test, expect, request as pwRequest, type APIRequestContext } from "@playwright/test";
import { PASSWORD, USERS } from "./helpers";

/** HTTP-level security tests against the running production build. */

const BASE = "http://localhost:3100";

async function apiAs(email: string): Promise<{ ctx: APIRequestContext; csrf: string }> {
  const ctx = await pwRequest.newContext({ baseURL: BASE, extraHTTPHeaders: { Origin: BASE } });
  const res = await ctx.post("/api/auth/login", { data: { email, password: PASSWORD } });
  expect(res.status()).toBe(200);
  const state = await ctx.storageState();
  const csrf = state.cookies.find((c) => c.name === "wk_csrf")!.value;
  return { ctx, csrf };
}

test.describe("authentication & session", () => {
  test("unauthenticated API calls are rejected", async ({ request }) => {
    for (const [m, path] of [["GET", "/api/me"], ["POST", "/api/requests/search"], ["GET", "/api/users"], ["GET", "/api/audit"]] as const) {
      const r = m === "GET" ? await request.get(path) : await request.post(path, { data: {}, headers: { Origin: BASE } });
      expect(r.status(), path).toBe(401);
    }
  });

  test("unauthenticated pages redirect to sign-in", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("session cookie is HttpOnly + SameSite and the token is opaque", async () => {
    const { ctx } = await apiAs(USERS.ops);
    const c = (await ctx.storageState()).cookies.find((x) => x.name === "wk_session")!;
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Lax");
    expect(c.value.length).toBeGreaterThanOrEqual(40);
    await ctx.dispose();
  });

  test("logout invalidates the session server-side", async () => {
    const { ctx, csrf } = await apiAs(USERS.ops);
    const state = await ctx.storageState();
    expect((await ctx.post("/api/auth/logout", { data: {}, headers: { "X-CSRF-Token": csrf } })).status()).toBe(200);
    // Replaying the old cookie must fail (session hijack after logout)
    const replay = await pwRequest.newContext({ baseURL: BASE, storageState: state });
    expect((await replay.get("/api/me")).status()).toBe(401);
    await replay.dispose();
    await ctx.dispose();
  });

  test("login is rate limited", async ({ request }) => {
    const email = `nobody-${Date.now()}@test.local`;
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await request.post("/api/auth/login", { data: { email, password: "wrong" }, headers: { Origin: BASE } })).status();
    }
    expect(last).toBe(429);
  });

  test("forgot-password does not reveal whether an account exists", async ({ request }) => {
    const a = await request.post("/api/auth/forgot", { data: { email: USERS.ops }, headers: { Origin: BASE } });
    const b = await request.post("/api/auth/forgot", { data: { email: "ghost@test.local" }, headers: { Origin: BASE } });
    expect(a.status()).toBe(200);
    expect(await a.json()).toEqual(await b.json());
  });
});

test.describe("CSRF & origin", () => {
  test("state-changing requests without the CSRF token are rejected", async () => {
    const { ctx } = await apiAs(USERS.ops);
    const r = await ctx.post("/api/requests", { data: { type: "MAPPING" } });
    expect(r.status()).toBe(403);
    expect((await r.json()).error.message).toMatch(/Security token/);
    await ctx.dispose();
  });

  test("cross-origin requests are rejected even with a valid token", async () => {
    const { ctx, csrf } = await apiAs(USERS.ops);
    const r = await ctx.post("/api/requests/search", { data: {}, headers: { "X-CSRF-Token": csrf, Origin: "https://evil.example" } });
    expect(r.status()).toBe(403);
    await ctx.dispose();
  });
});

test.describe("access control (RBAC / IDOR / privilege escalation)", () => {
  test("vendor cannot reach internal or admin APIs", async () => {
    const { ctx, csrf } = await apiAs(USERS.vendor);
    const h = { "X-CSRF-Token": csrf };
    expect((await ctx.get("/api/users")).status()).toBe(403);
    expect((await ctx.post("/api/audit", { data: { op: "search" }, headers: h })).status()).toBe(403);
    expect((await ctx.post("/api/reports/daily", { data: {}, headers: h })).status()).toBe(403);
    expect((await ctx.post("/api/requests/export", { data: {}, headers: h })).status()).toBe(403);
    expect((await ctx.post("/api/terminals/search", { data: {}, headers: h })).status()).toBe(403);
    expect((await ctx.post("/api/requests", { data: { type: "MAPPING" }, headers: h })).status()).toBe(403);
    expect((await ctx.post("/api/imports", { multipart: { kind: "MAPPING", file: { name: "a.csv", mimeType: "text/csv", buffer: Buffer.from("a\n1") } }, headers: h })).status()).toBe(403);
    await ctx.dispose();
  });

  test("vendor cannot open an internal draft by guessing its id (IDOR)", async () => {
    const ops = await apiAs(USERS.ops);
    const drafts = await ops.ctx.post("/api/requests/search", { data: { status: ["DRAFT", "READY_FOR_REVIEW"], pageSize: 1 }, headers: { "X-CSRF-Token": ops.csrf } });
    const id = (await drafts.json()).rows[0].id;
    const vendor = await apiAs(USERS.vendor);
    expect((await vendor.ctx.get(`/api/requests/${id}`)).status()).toBe(404);
    expect((await vendor.ctx.post(`/api/requests/${id}/action`, { data: { action: "treat", confirm: true }, headers: { "X-CSRF-Token": vendor.csrf } })).status()).toBe(404);
    expect((await vendor.ctx.post(`/api/requests/${id}/action`, { data: { action: "reveal" }, headers: { "X-CSRF-Token": vendor.csrf } })).status()).toBe(404);
    // Search cannot be widened to non-vendor statuses
    const s = await vendor.ctx.post("/api/requests/search", { data: { status: ["DRAFT", "READY_FOR_REVIEW", "RETURNED"] }, headers: { "X-CSRF-Token": vendor.csrf } });
    expect((await s.json()).total).toBe(0);
    await ops.ctx.dispose();
    await vendor.ctx.dispose();
  });

  test("vendor responses never contain internal comments or staff names", async () => {
    const vendor = await apiAs(USERS.vendor);
    const s = await (await vendor.ctx.post("/api/requests/search", { data: { pageSize: 100 }, headers: { "X-CSRF-Token": vendor.csrf } })).json();
    const body = JSON.stringify(s);
    expect(body).not.toMatch(/Ola Operations|Ngozi Operations|Femi Field|Sade Superadmin/);
    const d = await (await vendor.ctx.get(`/api/requests/${s.rows[0].id}`)).json();
    expect(d.internalComment).toBeNull();
    expect(d.reason).toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/Ola Operations|Ngozi Operations|Femi Field/);
    await vendor.ctx.dispose();
  });

  test("operations user cannot escalate to Super Admin", async () => {
    const ops = await apiAs(USERS.ops);
    const me = await (await ops.ctx.get("/api/me")).json();
    const r = await ops.ctx.patch(`/api/users/${me.user.id}`, { data: { email: USERS.ops, fullName: "x", role: "SUPER_ADMIN", isActive: true }, headers: { "X-CSRF-Token": ops.csrf } });
    expect(r.status()).toBe(403);
    await ops.ctx.dispose();
  });

  test("field submitter list view is limited to own submissions", async () => {
    const field = await apiAs(USERS.field);
    const s = await (await field.ctx.post("/api/requests/search", { data: { pageSize: 200 }, headers: { "X-CSRF-Token": field.csrf } })).json();
    expect(s.rows.every((r: { createdByName: string }) => r.createdByName === "Femi Field Officer (Test)")).toBe(true);
    expect((await field.ctx.post("/api/requests/export", { data: {}, headers: { "X-CSRF-Token": field.csrf } })).status()).toBe(403);
    await field.ctx.dispose();
  });
});

test.describe("input handling", () => {
  test("SQL injection strings are treated as data", async () => {
    const ops = await apiAs(USERS.ops);
    for (const q of ["' OR 1=1 --", "1); DROP TABLE requests; --", "%' UNION SELECT password_hash FROM users --"]) {
      const r = await ops.ctx.post("/api/requests/search", { data: { q }, headers: { "X-CSRF-Token": ops.csrf } });
      expect(r.status()).toBe(200);
      expect((await r.json()).total).toBe(0);
    }
    const sort = await ops.ctx.post("/api/requests/search", { data: { sort: "created_at; drop table users" }, headers: { "X-CSRF-Token": ops.csrf } });
    expect(sort.status()).toBe(422);
    await ops.ctx.dispose();
  });

  test("malformed ids and bodies produce clean errors, not stack traces", async () => {
    const ops = await apiAs(USERS.ops);
    const r = await ops.ctx.get("/api/requests/not-a-uuid");
    expect(r.status()).toBe(404);
    const bad = await ops.ctx.post("/api/requests/search", { data: "{not json", headers: { "X-CSRF-Token": ops.csrf, "Content-Type": "application/json" } });
    expect(bad.status()).toBe(400);
    const text = await bad.text();
    expect(text).not.toMatch(/at \w+ \(|node_modules|SELECT /);
    await ops.ctx.dispose();
  });

  test("spoofed upload files are rejected", async () => {
    const ops = await apiAs(USERS.ops);
    const r = await ops.ctx.post("/api/imports", {
      multipart: { kind: "MAPPING", file: { name: "evil.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: Buffer.from("<script>alert(1)</script>") } },
      headers: { "X-CSRF-Token": ops.csrf },
    });
    expect(r.status()).toBe(400);
    const r2 = await ops.ctx.post("/api/imports", {
      multipart: { kind: "MAPPING", file: { name: "shell.php", mimeType: "text/plain", buffer: Buffer.from("<?php ?>") } },
      headers: { "X-CSRF-Token": ops.csrf },
    });
    expect(r2.status()).toBe(400);
    await ops.ctx.dispose();
  });

  test("account numbers cannot be searched via URL and are masked in list responses", async () => {
    const ops = await apiAs(USERS.ops);
    const s = await (await ops.ctx.post("/api/requests/search", { data: { pageSize: 50 }, headers: { "X-CSRF-Token": ops.csrf } })).json();
    for (const r of s.rows) expect(r.account).toMatch(/^••••••\d{4}$/);
    await ops.ctx.dispose();
  });
});

test("security headers are present", async ({ request }) => {
  const r = await request.get("/login");
  const h = r.headers();
  expect(h["content-security-policy"]).toMatch(/default-src 'self'/);
  expect(h["content-security-policy"]).toMatch(/frame-ancestors 'none'/);
  expect(h["content-security-policy"]).toMatch(/script-src 'self' 'nonce-/);
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("same-origin");
  expect(h["x-powered-by"]).toBeUndefined();
  const api = await request.get("/api/health");
  expect(api.headers()["cache-control"]).toMatch(/no-store/);
});
