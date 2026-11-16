import "server-only";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import { getDb, type DbOrTx } from "../db/client";
import { passwordResetTokens, sessions, users, vendors } from "../db/schema";
import { config } from "../config";
import { decrypt, encrypt, randomToken, sha256 } from "../crypto";
import { writeAudit } from "../audit";
import { AppError } from "../errors";
import { DUMMY_HASH, hashPassword, verifyPassword } from "./password";
import { verifyTotp } from "./totp";
import { passwordPolicy } from "@/lib/validation";
import type { Actor } from "../actor";
import type { Role } from "@/lib/constants";
import { notifyEmail } from "../notifications";

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: Role;
  vendorId: string | null;
  vendorName: string | null;
  mustChangePassword: boolean;
  mfaEnabled: boolean;
}

export interface ActiveSession {
  sessionId: string;
  csrfToken: string;
  mfaPassed: boolean;
  user: SessionUser;
}

const GENERIC_LOGIN_ERROR = "Invalid email or password.";

function auditActorFromUser(u: { id: string; email: string; role: string }, meta: RequestMeta) {
  return { id: u.id, email: u.email, role: u.role, ip: meta.ip, userAgent: meta.userAgent };
}

export async function login(
  emailRaw: string,
  password: string,
  meta: RequestMeta,
): Promise<{ token: string; csrfToken: string; mfaRequired: boolean; mustChangePassword: boolean }> {
  const db = getDb();
  const cfg = config();
  const email = String(emailRaw ?? "").trim().toLowerCase().slice(0, 200);
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);

  if (!user) {
    await verifyPassword(password, DUMMY_HASH); // equalise timing
    await writeAudit(db, { id: null, email, role: "ANONYMOUS", ip: meta.ip, userAgent: meta.userAgent }, {
      action: "AUTH_LOGIN_FAILED",
      entityType: "user",
      newValue: { reason: "unknown_user" },
    });
    throw new AppError("UNAUTHENTICATED", GENERIC_LOGIN_ERROR);
  }

  const now = new Date();
  if (user.lockedUntil && user.lockedUntil > now) {
    await writeAudit(db, auditActorFromUser(user, meta), {
      action: "AUTH_LOGIN_BLOCKED_LOCKED",
      entityType: "user",
      entityId: user.id,
    });
    throw new AppError("LOCKED", "This account is temporarily locked after repeated failed sign-in attempts. Try again later or contact an administrator.");
  }

  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok || !user.isActive) {
    const attempts = user.failedLoginAttempts + 1;
    const lock = attempts >= cfg.MAX_FAILED_LOGINS;
    await db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({
          failedLoginAttempts: lock ? 0 : attempts,
          lockedUntil: lock ? new Date(now.getTime() + cfg.LOCKOUT_MINUTES * 60_000) : user.lockedUntil,
        })
        .where(eq(users.id, user.id));
      await writeAudit(tx, auditActorFromUser(user, meta), {
        action: lock ? "AUTH_ACCOUNT_LOCKED" : "AUTH_LOGIN_FAILED",
        entityType: "user",
        entityId: user.id,
        newValue: { attempts, reason: user.isActive ? "bad_password" : "inactive" },
      });
    });
    throw new AppError("UNAUTHENTICATED", GENERIC_LOGIN_ERROR);
  }

  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const mfaRequired = user.mfaEnabled;
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ failedLoginAttempts: 0, lockedUntil: null, lastLoginAt: mfaRequired ? user.lastLoginAt : now })
      .where(eq(users.id, user.id));
    await tx.insert(sessions).values({
      tokenHash: sha256(token),
      csrfToken,
      userId: user.id,
      mfaPassed: !mfaRequired,
      ip: meta.ip,
      userAgent: meta.userAgent?.slice(0, 300) ?? null,
      // An MFA-pending session is only valid for 5 minutes.
      expiresAt: new Date(now.getTime() + (mfaRequired ? 5 : cfg.SESSION_ABSOLUTE_TIMEOUT_MINUTES) * 60_000),
    });
    await writeAudit(tx, auditActorFromUser(user, meta), {
      action: mfaRequired ? "AUTH_PASSWORD_OK_MFA_PENDING" : "AUTH_LOGIN",
      entityType: "user",
      entityId: user.id,
    });
  });
  return { token, csrfToken, mfaRequired, mustChangePassword: user.mustChangePassword };
}

export async function verifyMfa(token: string, code: string, meta: RequestMeta): Promise<void> {
  const db = getDb();
  const cfg = config();
  const s = await getSession(token, { allowMfaPending: true });
  if (!s) throw new AppError("UNAUTHENTICATED", "Your sign-in has expired. Please sign in again.");
  const [u] = await db.select().from(users).where(eq(users.id, s.user.id));
  if (!u?.mfaEnabled || !u.mfaSecretEnc) throw new AppError("BAD_REQUEST", "MFA is not enabled for this account.");
  if (!verifyTotp(decrypt(u.mfaSecretEnc), code)) {
    await writeAudit(db, auditActorFromUser(u, meta), { action: "AUTH_MFA_FAILED", entityType: "user", entityId: u.id });
    throw new AppError("UNAUTHENTICATED", "Invalid verification code.");
  }
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(sessions)
      .set({ mfaPassed: true, expiresAt: new Date(now.getTime() + cfg.SESSION_ABSOLUTE_TIMEOUT_MINUTES * 60_000) })
      .where(eq(sessions.id, s.sessionId));
    await tx.update(users).set({ lastLoginAt: now }).where(eq(users.id, u.id));
    await writeAudit(tx, auditActorFromUser(u, meta), { action: "AUTH_LOGIN", entityType: "user", entityId: u.id, newValue: { mfa: true } });
  });
}

/**
 * Resolve a session token. Enforces absolute expiry, idle timeout, revocation and user status.
 * Slides last_seen_at (throttled to once per minute).
 */
export async function getSession(
  token: string | undefined | null,
  opts: { allowMfaPending?: boolean } = {},
): Promise<ActiveSession | null> {
  if (!token || token.length > 100) return null;
  const db = getDb();
  const cfg = config();
  const now = new Date();
  const [row] = await db
    .select({ s: sessions, u: users, vendorName: vendors.name })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(vendors, eq(vendors.id, users.vendorId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!row) return null;
  const idleLimit = now.getTime() - cfg.SESSION_IDLE_TIMEOUT_MINUTES * 60_000;
  if (row.s.lastSeenAt.getTime() < idleLimit || !row.u.isActive) {
    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, row.s.id));
    return null;
  }
  if (!row.s.mfaPassed && !opts.allowMfaPending) return null;
  if (now.getTime() - row.s.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.s.id));
  }
  return {
    sessionId: row.s.id,
    csrfToken: row.s.csrfToken,
    mfaPassed: row.s.mfaPassed,
    user: {
      id: row.u.id,
      email: row.u.email,
      fullName: row.u.fullName,
      role: row.u.role,
      vendorId: row.u.vendorId,
      vendorName: row.vendorName ?? null,
      mustChangePassword: row.u.mustChangePassword,
      mfaEnabled: row.u.mfaEnabled,
    },
  };
}

export async function logout(token: string, actor: Actor | null): Promise<void> {
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token)));
    if (actor) {
      await writeAudit(tx, actor, { action: "AUTH_LOGOUT", entityType: "user", entityId: actor.id });
    }
  });
}

export async function revokeAllSessions(userId: string, tx: DbOrTx = getDb()): Promise<void> {
  await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

export async function changePassword(actor: Actor, currentPassword: string, newPassword: string, keepSessionId: string) {
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.id, actor.id));
  if (!u || !(await verifyPassword(currentPassword, u.passwordHash))) {
    throw new AppError("VALIDATION", "Current password is incorrect.", { currentPassword: "Current password is incorrect." });
  }
  const parsed = passwordPolicy.safeParse(newPassword);
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0].message, { newPassword: parsed.error.issues[0].message });
  if (await verifyPassword(newPassword, u.passwordHash)) {
    throw new AppError("VALIDATION", "New password must be different from the current password.", { newPassword: "Choose a different password." });
  }
  const hash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: hash, mustChangePassword: false, passwordChangedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, u.id));
    // Revoke all other sessions.
    await tx
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, u.id), isNull(sessions.revokedAt), sql`${sessions.id} <> ${keepSessionId}`));
    await writeAudit(tx, actor, { action: "AUTH_PASSWORD_CHANGED", entityType: "user", entityId: u.id });
  });
}

/**
 * Self-service reset request. Always behaves identically whether or not the email exists
 * (no account enumeration). Delivery goes through the notification email channel.
 */
export async function requestPasswordReset(emailRaw: string, meta: RequestMeta): Promise<void> {
  const db = getDb();
  const email = String(emailRaw ?? "").trim().toLowerCase().slice(0, 200);
  const [u] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
  if (!u || !u.isActive) {
    await writeAudit(db, { id: null, email, role: "ANONYMOUS", ip: meta.ip, userAgent: meta.userAgent }, {
      action: "AUTH_RESET_REQUESTED_UNKNOWN",
      entityType: "user",
    });
    return;
  }
  const token = await createResetToken(u.id, null);
  await writeAudit(db, auditActorFromUser(u, meta), { action: "AUTH_RESET_REQUESTED", entityType: "user", entityId: u.id });
  const link = `${config().APP_URL}/reset-password#token=${token}`;
  await notifyEmail({
    to: u.email,
    subject: "Reset your Wakeel Terminal Mapping password",
    text: `A password reset was requested for your account. Use this link within 30 minutes: ${link}\nIf you did not request this, ignore this email and inform your administrator.`,
  });
}

/** Creates a single-use, 30-minute reset token (only its hash is stored). */
export async function createResetToken(userId: string, createdBy: string | null): Promise<string> {
  const db = getDb();
  const token = randomToken(32);
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.usedAt)));
  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash: sha256(token),
    expiresAt: new Date(Date.now() + 30 * 60_000),
    createdBy,
  });
  return token;
}

export async function completePasswordReset(token: string, newPassword: string, meta: RequestMeta): Promise<void> {
  const db = getDb();
  const parsed = passwordPolicy.safeParse(newPassword);
  if (!parsed.success) throw new AppError("VALIDATION", parsed.error.issues[0].message, { password: parsed.error.issues[0].message });
  const now = new Date();
  const [t] = await db
    .select()
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.tokenHash, sha256(String(token ?? ""))), isNull(passwordResetTokens.usedAt), gt(passwordResetTokens.expiresAt, now)))
    .limit(1);
  if (!t) throw new AppError("BAD_REQUEST", "This reset link is invalid or has expired. Please request a new one.");
  const [u] = await db.select().from(users).where(eq(users.id, t.userId));
  const hash = await hashPassword(newPassword);
  await db.transaction(async (tx) => {
    const used = await tx
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.id, t.id), isNull(passwordResetTokens.usedAt)))
      .returning({ id: passwordResetTokens.id });
    if (used.length === 0) throw new AppError("BAD_REQUEST", "This reset link has already been used.");
    await tx
      .update(users)
      .set({ passwordHash: hash, mustChangePassword: false, failedLoginAttempts: 0, lockedUntil: null, passwordChangedAt: now, updatedAt: now })
      .where(eq(users.id, t.userId));
    await revokeAllSessions(t.userId, tx);
    await writeAudit(tx, auditActorFromUser(u, meta), { action: "AUTH_PASSWORD_RESET", entityType: "user", entityId: u.id });
  });
}

export async function enableMfa(actor: Actor, secret: string, code: string) {
  if (!verifyTotp(secret, code)) throw new AppError("VALIDATION", "The code does not match. Check your authenticator app's time and try again.");
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(users).set({ mfaEnabled: true, mfaSecretEnc: encrypt(secret), updatedAt: new Date() }).where(eq(users.id, actor.id));
    await writeAudit(tx, actor, { action: "AUTH_MFA_ENABLED", entityType: "user", entityId: actor.id });
  });
}

/** Housekeeping: delete expired/revoked sessions older than 7 days. */
export async function purgeSessions(): Promise<number> {
  const db = getDb();
  const cutoff = new Date(Date.now() - 7 * 24 * 3600_000);
  const res = await db
    .delete(sessions)
    .where(or(lt(sessions.expiresAt, cutoff), and(sql`${sessions.revokedAt} is not null`, lt(sessions.revokedAt, cutoff))))
    .returning({ id: sessions.id });
  return res.length;
}
