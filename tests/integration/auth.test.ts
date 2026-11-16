import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { passwordResetTokens, sessions, users, auditLogs } from "@/server/db/schema";
import * as auth from "@/server/auth/service";
import { createUser, updateUser, adminResetPassword } from "@/server/services/users";
import { AppError } from "@/server/errors";
import { sha256 } from "@/server/crypto";
import { totpCode, generateTotpSecret } from "@/server/auth/totp";
import { makeUser, PASSWORD } from "../fixtures";

const meta = { ip: "10.0.0.1", userAgent: "vitest" };

async function err(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected error");
}

describe("authentication", () => {
  let user: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    user = await makeUser("WAKEEL_ADMIN");
  });

  it("logs in with valid credentials (case-insensitive email) and creates a session", async () => {
    const r = await auth.login(user.email.toUpperCase(), PASSWORD, meta);
    expect(r.token.length).toBeGreaterThan(30);
    const s = await auth.getSession(r.token);
    expect(s?.user.id).toBe(user.id);
    // Only a hash of the token is stored
    const rows = await getDb().select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows.some((x) => x.tokenHash === r.token)).toBe(false);
    expect(rows.some((x) => x.tokenHash === sha256(r.token))).toBe(true);
  });

  it("returns the same generic error for unknown user and wrong password", async () => {
    const a = await err(auth.login("nobody@test.local", PASSWORD, meta));
    const b = await err(auth.login(user.email, "wrong-password", meta));
    expect(a.code).toBe("UNAUTHENTICATED");
    expect(a.message).toBe(b.message);
  });

  it("locks the account after repeated failures and records the lockout", async () => {
    const u = await makeUser("FIELD_SUBMITTER");
    for (let i = 0; i < 5; i++) await err(auth.login(u.email, "bad", meta));
    const locked = await err(auth.login(u.email, PASSWORD, meta)); // correct password still refused
    expect(locked.code).toBe("LOCKED");
    const a = await getDb().select().from(auditLogs).where(eq(auditLogs.entityId, u.id));
    expect(a.map((x) => x.action)).toContain("AUTH_ACCOUNT_LOCKED");
  });

  it("logout revokes the session", async () => {
    const r = await auth.login(user.email, PASSWORD, meta);
    await auth.logout(r.token, user);
    expect(await auth.getSession(r.token)).toBeNull();
  });

  it("expires idle sessions", async () => {
    const r = await auth.login(user.email, PASSWORD, meta);
    await getDb().update(sessions).set({ lastSeenAt: new Date(Date.now() - 31 * 60_000) }).where(eq(sessions.tokenHash, sha256(r.token)));
    expect(await auth.getSession(r.token)).toBeNull();
  });

  it("expires sessions past the absolute timeout", async () => {
    const r = await auth.login(user.email, PASSWORD, meta);
    await getDb().update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.tokenHash, sha256(r.token)));
    expect(await auth.getSession(r.token)).toBeNull();
  });

  it("rejects garbage / oversized tokens", async () => {
    expect(await auth.getSession("")).toBeNull();
    expect(await auth.getSession("x".repeat(500))).toBeNull();
    expect(await auth.getSession("' or 1=1 --")).toBeNull();
  });

  it("deactivated users lose access immediately", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const u = await makeUser("WAKEEL_ADMIN");
    const r = await auth.login(u.email, PASSWORD, meta);
    await updateUser(admin, u.id, { email: u.email, fullName: u.fullName, role: "WAKEEL_ADMIN", isActive: false });
    expect(await auth.getSession(r.token)).toBeNull();
    expect((await err(auth.login(u.email, PASSWORD, meta))).code).toBe("UNAUTHENTICATED");
  });

  it("role change forces re-authentication (no privilege carry-over)", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const u = await makeUser("WAKEEL_ADMIN");
    const r = await auth.login(u.email, PASSWORD, meta);
    await updateUser(admin, u.id, { email: u.email, fullName: u.fullName, role: "FIELD_SUBMITTER", isActive: true });
    expect(await auth.getSession(r.token)).toBeNull();
  });
});

describe("password reset", () => {
  it("single-use, expiring reset tokens; sessions revoked after reset", async () => {
    const u = await makeUser("WAKEEL_ADMIN");
    const s = await auth.login(u.email, PASSWORD, meta);
    const token = await auth.createResetToken(u.id, null);
    expect((await err(auth.completePasswordReset(token, "weak", meta))).code).toBe("VALIDATION");
    await auth.completePasswordReset(token, "Brand#NewPass2026", meta);
    expect(await auth.getSession(s.token)).toBeNull();
    expect((await err(auth.completePasswordReset(token, "Another#Pass2026", meta))).code).toBe("BAD_REQUEST");
    const r = await auth.login(u.email, "Brand#NewPass2026", meta);
    expect(r.token).toBeTruthy();
    // expired token
    const t2 = await auth.createResetToken(u.id, null);
    await getDb().update(passwordResetTokens).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(passwordResetTokens.tokenHash, sha256(t2)));
    expect((await err(auth.completePasswordReset(t2, "Third#Pass20266", meta))).code).toBe("BAD_REQUEST");
  });

  it("does not reveal whether an email exists", async () => {
    await expect(auth.requestPasswordReset("ghost@test.local", meta)).resolves.toBeUndefined();
  });

  it("admin-created users must set their own password", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const res = await createUser(admin, { email: `new-${Date.now()}@test.local`, fullName: "New User", role: "FIELD_SUBMITTER" });
    expect(res.setPasswordLink).toMatch(/reset-password#token=/);
    const [u] = await getDb().select().from(users).where(eq(users.id, res.user.id));
    expect(u.mustChangePassword).toBe(true);
    const reset = await adminResetPassword(admin, u.id);
    expect(reset.link).toMatch(/#token=/);
  });

  it("vendor users must be bound to a vendor", async () => {
    const admin = await makeUser("SUPER_ADMIN");
    const e = await err(createUser(admin, { email: `v-${Date.now()}@test.local`, fullName: "Vendor Person", role: "VENDOR_USER" }));
    expect(e.code).toBe("VALIDATION");
  });

  it("non-admins cannot manage users (privilege escalation)", async () => {
    const ops = await makeUser("WAKEEL_ADMIN");
    const e = await err(updateUser(ops, ops.id, { email: ops.email, fullName: ops.fullName, role: "SUPER_ADMIN", isActive: true }));
    expect(e.code).toBe("FORBIDDEN");
  });
});

describe("MFA (TOTP)", () => {
  it("requires a second factor when enabled", async () => {
    const u = await makeUser("SUPER_ADMIN");
    const secret = generateTotpSecret();
    expect((await err(auth.enableMfa(u, secret, "000000"))).code).toBe("VALIDATION");
    await auth.enableMfa(u, secret, totpCode(secret));
    const r = await auth.login(u.email, PASSWORD, meta);
    expect(r.mfaRequired).toBe(true);
    expect(await auth.getSession(r.token)).toBeNull(); // not usable yet
    expect((await err(auth.verifyMfa(r.token, "123456", meta))).code).toBe("UNAUTHENTICATED");
    await auth.verifyMfa(r.token, totpCode(secret), meta);
    expect((await auth.getSession(r.token))?.user.id).toBe(u.id);
  });
});
