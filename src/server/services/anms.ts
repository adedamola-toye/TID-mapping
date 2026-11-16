import "server-only";
import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../db/client";
import { anms, terminalMappings, terminals } from "../db/schema";
import { writeAudit } from "../audit";
import { AppError, fromDbError, notFound } from "../errors";
import type { Actor } from "../actor";
import { can } from "../rbac";
import { NIGERIAN_STATES } from "@/lib/constants";
import { fieldErrors } from "@/lib/validation";

export const anmInputSchema = z.object({
  code: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .refine((v) => /^[A-Z0-9\-]{2,32}$/.test(v), "Code must be 2–32 letters/digits."),
  fullName: z
    .string()
    .transform((v) => v.replace(/\s+/g, " ").trim())
    .refine((v) => v.length >= 2 && v.length <= 150, "Name is required."),
  email: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.trim().toLowerCase() : null))
    .refine((v) => v === null || z.string().email().safeParse(v).success, "Invalid email."),
  phone: z
    .string()
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/\s+/g, "") : null))
    .refine((v) => v === null || /^\+?\d{7,15}$/.test(v), "Invalid phone number."),
  regions: z.array(z.enum(NIGERIAN_STATES)).default([]),
  isActive: z.boolean().default(true),
});

function requireManage(actor: Actor) {
  if (!can(actor.role, "anm:manage")) throw new AppError("FORBIDDEN", "Only administrators can manage ANMs.");
}

/** Active ANMs for dropdowns — inactive ANMs never appear in new assignments. */
export async function listActiveAnms() {
  const db = getDb();
  return db
    .select({ id: anms.id, code: anms.code, fullName: anms.fullName, regions: anms.regions })
    .from(anms)
    .where(eq(anms.isActive, true))
    .orderBy(asc(anms.fullName));
}

export async function listAnms(opts: { q?: string; includeInactive?: boolean } = {}) {
  const db = getDb();
  const conds = [];
  if (!opts.includeInactive) conds.push(eq(anms.isActive, true));
  if (opts.q) {
    const like = `%${opts.q.slice(0, 100)}%`;
    conds.push(or(ilike(anms.fullName, like), ilike(anms.code, like)));
  }
  return db
    .select({
      id: anms.id,
      code: anms.code,
      fullName: anms.fullName,
      email: anms.email,
      phone: anms.phone,
      regions: anms.regions,
      isActive: anms.isActive,
      terminalCount: sql<number>`(select count(*)::int from ${terminalMappings} tm where tm.anm_id = ${anms.id} and tm.is_current)`,
    })
    .from(anms)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(anms.fullName));
}

export async function getAnm(id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound("ANM");
  const db = getDb();
  const [a] = await db.select().from(anms).where(eq(anms.id, id));
  if (!a) throw notFound("ANM");
  const portfolio = await db
    .select({
      terminalId: terminals.id,
      serialNumber: terminals.serialNumber,
      tid: terminals.tid,
      agentName: terminalMappings.agentName,
      state: terminalMappings.state,
      since: terminalMappings.effectiveFrom,
    })
    .from(terminalMappings)
    .innerJoin(terminals, eq(terminals.id, terminalMappings.terminalId))
    .where(and(eq(terminalMappings.anmId, id), eq(terminalMappings.isCurrent, true)))
    .orderBy(asc(terminals.serialNumber))
    .limit(500);
  return { anm: a, portfolio };
}

export async function createAnm(actor: Actor, input: unknown) {
  requireManage(actor);
  const parsed = anmInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", "Please correct the highlighted fields.", fieldErrors(parsed.error));
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(anms).values(parsed.data).returning();
      await writeAudit(tx, actor, { action: "ANM_CREATED", entityType: "anm", entityId: row.id, entityLabel: row.fullName, newValue: parsed.data });
      return row;
    });
  } catch (e) {
    throw fromDbError(e) ?? e;
  }
}

export async function updateAnm(actor: Actor, id: string, input: unknown) {
  requireManage(actor);
  const parsed = anmInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", "Please correct the highlighted fields.", fieldErrors(parsed.error));
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const [old] = await tx.select().from(anms).where(eq(anms.id, id)).for("update");
      if (!old) throw notFound("ANM");
      const [row] = await tx.update(anms).set({ ...parsed.data, updatedAt: new Date() }).where(eq(anms.id, id)).returning();
      const action = old.isActive !== row.isActive ? (row.isActive ? "ANM_ACTIVATED" : "ANM_DEACTIVATED") : "ANM_UPDATED";
      await writeAudit(tx, actor, {
        action,
        entityType: "anm",
        entityId: id,
        entityLabel: row.fullName,
        oldValue: { code: old.code, fullName: old.fullName, email: old.email, phone: old.phone, regions: old.regions, isActive: old.isActive },
        newValue: parsed.data,
      });
      return row;
    });
  } catch (e) {
    throw fromDbError(e) ?? e;
  }
}
