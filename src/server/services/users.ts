import "server-only";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { users, vendors } from "../db/schema";
import { writeAudit } from "../audit";
import { AppError, forbidden, fromDbError, notFound } from "../errors";
import type { Actor } from "../actor";
import { can } from "../rbac";
import { hashPassword } from "../auth/password";
import { createResetToken, revokeAllSessions } from "../auth/service";
import { randomToken } from "../crypto";
import { config } from "../config";
import { ROLES } from "@/lib/constants";
import { fieldErrors } from "@/lib/validation";

const userInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email.").max(200),
  fullName: z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .refine((v) => v.length >= 2 && v.length <= 150, "Full name is required."),
  role: z.enum(ROLES),
  vendorId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().default(true),
});

function requireManage(actor: Actor) {
  if (!can(actor.role, "user:manage")) throw forbidden();
}

export async function listUsers(actor: Actor, q?: string) {
  requireManage(actor);
  const db = getDb();
  const like = q ? `%${q.slice(0, 100)}%` : null;
  return db
    .select({
      id: users.id,
      email: users.email,
      fullName: users.fullName,
      role: users.role,
      vendorName: vendors.name,
      vendorId: users.vendorId,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
      lockedUntil: users.lockedUntil,
      mfaEnabled: users.mfaEnabled,
      mustChangePassword: users.mustChangePassword,
      createdAt: users.createdAt,
    })
    .from(users)
    .leftJoin(vendors, eq(vendors.id, users.vendorId))
    .where(like ? or(ilike(users.fullName, like), ilike(users.email, like)) : undefined)
    .orderBy(asc(users.fullName));
}

async function validateVendorScope(role: string, vendorId: string | null | undefined) {
  if (role === "VENDOR_USER") {
    if (!vendorId) throw new AppError("VALIDATION", "Vendor users must be linked to a vendor.", { vendorId: "Select the vendor." });
    const [v] = await getDb().select().from(vendors).where(eq(vendors.id, vendorId));
    if (!v) throw new AppError("VALIDATION", "Unknown vendor.", { vendorId: "Unknown vendor." });
    return vendorId;
  }
  return null;
}

/**
 * Create a user with a random temporary password and a one-time password-set link.
 * The admin hands over the link through an approved channel; the user must set their own password.
 */
export async function createUser(actor: Actor, input: unknown) {
  requireManage(actor);
  const parsed = userInput.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", "Please correct the highlighted fields.", fieldErrors(parsed.error));
  const d = parsed.data;
  const vendorId = await validateVendorScope(d.role, d.vendorId);
  const db = getDb();
  try {
    const user = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          email: d.email,
          fullName: d.fullName,
          role: d.role,
          vendorId,
          isActive: d.isActive,
          passwordHash: await hashPassword(randomToken(24)),
          mustChangePassword: true,
        })
        .returning();
      await writeAudit(tx, actor, { action: "USER_CREATED", entityType: "user", entityId: u.id, entityLabel: u.email, newValue: { email: u.email, fullName: u.fullName, role: u.role, vendorId } });
      return u;
    });
    const token = await createResetToken(user.id, actor.id);
    return { user: { id: user.id, email: user.email }, setPasswordLink: `${config().APP_URL}/reset-password#token=${token}` };
  } catch (e) {
    throw fromDbError(e) ?? e;
  }
}

export async function updateUser(actor: Actor, id: string, input: unknown) {
  requireManage(actor);
  const parsed = userInput.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", "Please correct the highlighted fields.", fieldErrors(parsed.error));
  const d = parsed.data;
  const vendorId = await validateVendorScope(d.role, d.vendorId);
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const [old] = await tx.select().from(users).where(eq(users.id, id)).for("update");
      if (!old) throw notFound("User");
      if (id === actor.id && (d.role !== old.role || !d.isActive)) {
        throw new AppError("VALIDATION", "You cannot change your own role or deactivate yourself.");
      }
      if (old.role === "SUPER_ADMIN" && (d.role !== "SUPER_ADMIN" || !d.isActive)) {
        const [{ n }] = await tx
          .select({ n: sql<number>`count(*)::int` })
          .from(users)
          .where(and(eq(users.role, "SUPER_ADMIN"), eq(users.isActive, true)));
        if (n <= 1) throw new AppError("VALIDATION", "At least one active Super Admin must remain.");
      }
      const [u] = await tx
        .update(users)
        .set({ email: d.email, fullName: d.fullName, role: d.role, vendorId, isActive: d.isActive, updatedAt: new Date() })
        .where(eq(users.id, id))
        .returning();
      // Privilege or status change → force re-authentication.
      if (old.role !== u.role || old.isActive !== u.isActive || old.vendorId !== u.vendorId) await revokeAllSessions(id, tx);
      await writeAudit(tx, actor, {
        action: old.role !== u.role ? "USER_ROLE_CHANGED" : old.isActive !== u.isActive ? (u.isActive ? "USER_ACTIVATED" : "USER_DEACTIVATED") : "USER_UPDATED",
        entityType: "user",
        entityId: id,
        entityLabel: u.email,
        oldValue: { email: old.email, fullName: old.fullName, role: old.role, vendorId: old.vendorId, isActive: old.isActive },
        newValue: { email: u.email, fullName: u.fullName, role: u.role, vendorId: u.vendorId, isActive: u.isActive },
      });
      return u;
    });
  } catch (e) {
    throw fromDbError(e) ?? e;
  }
}

/** Admin-initiated reset: returns a one-time link (30 min) and unlocks the account. */
export async function adminResetPassword(actor: Actor, id: string) {
  requireManage(actor);
  const db = getDb();
  const [u] = await db.select().from(users).where(eq(users.id, id));
  if (!u) throw notFound("User");
  const token = await createResetToken(u.id, actor.id);
  await db.transaction(async (tx) => {
    await tx.update(users).set({ failedLoginAttempts: 0, lockedUntil: null, mustChangePassword: true }).where(eq(users.id, id));
    await revokeAllSessions(id, tx);
    await writeAudit(tx, actor, { action: "USER_PASSWORD_RESET_ISSUED", entityType: "user", entityId: id, entityLabel: u.email });
  });
  return { link: `${config().APP_URL}/reset-password#token=${token}` };
}

export async function unlockUser(actor: Actor, id: string) {
  requireManage(actor);
  const db = getDb();
  await db.transaction(async (tx) => {
    const [u] = await tx.update(users).set({ failedLoginAttempts: 0, lockedUntil: null }).where(eq(users.id, id)).returning();
    if (!u) throw notFound("User");
    await writeAudit(tx, actor, { action: "USER_UNLOCKED", entityType: "user", entityId: id, entityLabel: u.email });
  });
}

export async function resetUserMfa(actor: Actor, id: string) {
  requireManage(actor);
  const db = getDb();
  await db.transaction(async (tx) => {
    const [u] = await tx.update(users).set({ mfaEnabled: false, mfaSecretEnc: null }).where(eq(users.id, id)).returning();
    if (!u) throw notFound("User");
    await revokeAllSessions(id, tx);
    await writeAudit(tx, actor, { action: "USER_MFA_RESET", entityType: "user", entityId: id, entityLabel: u.email });
  });
}

/* ───────────── vendors ───────────── */

const vendorInput = z.object({
  code: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .refine((v) => /^[A-Z0-9_\-]{2,32}$/.test(v), "Code must be 2–32 letters/digits."),
  name: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= 2 && v.length <= 120, "Name is required."),
  contactEmail: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.trim().toLowerCase() : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Invalid email."),
  isActive: z.boolean().default(true),
});

export async function listVendors() {
  const db = getDb();
  return db
    .select({
      id: vendors.id,
      code: vendors.code,
      name: vendors.name,
      contactEmail: vendors.contactEmail,
      isActive: vendors.isActive,
      userCount: sql<number>`(select count(*)::int from users u where u.vendor_id = ${vendors.id})`,
    })
    .from(vendors)
    .orderBy(asc(vendors.name));
}

export async function saveVendor(actor: Actor, id: string | null, input: unknown) {
  if (!can(actor.role, "vendor:manage")) throw forbidden();
  const parsed = vendorInput.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", "Please correct the highlighted fields.", fieldErrors(parsed.error));
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      if (id) {
        const [old] = await tx.select().from(vendors).where(eq(vendors.id, id));
        if (!old) throw notFound("Vendor");
        const [v] = await tx.update(vendors).set({ ...parsed.data, updatedAt: new Date() }).where(eq(vendors.id, id)).returning();
        await writeAudit(tx, actor, { action: "VENDOR_UPDATED", entityType: "vendor", entityId: id, entityLabel: v.name, oldValue: old, newValue: parsed.data });
        return v;
      }
      const [v] = await tx.insert(vendors).values(parsed.data).returning();
      await writeAudit(tx, actor, { action: "VENDOR_CREATED", entityType: "vendor", entityId: v.id, entityLabel: v.name, newValue: parsed.data });
      return v;
    });
  } catch (e) {
    throw fromDbError(e) ?? e;
  }
}
