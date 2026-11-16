import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getDb } from "../db/client";
import { requests, terminalMappings, terminals, users, vendors } from "../db/schema";
import { AppError, forbidden, fromDbError, notFound } from "../errors";
import { writeAudit } from "../audit";
import { hmac } from "../crypto";
import type { Actor } from "../actor";
import { can } from "../rbac";
import { OPEN_STATUSES, TERMINAL_STATUSES, normalizeState } from "@/lib/constants";
import { maskAccount } from "@/lib/format";
import { fieldErrors, normalizeAccount, normalizeIdentifier, optionalTidSchema } from "@/lib/validation";

function requireView(actor: Actor) {
  if (!can(actor.role, "terminal:view")) throw forbidden();
}

export const terminalSearchSchema = z.object({
  q: z.string().max(100).optional(),
  accountNumber: z.string().max(20).optional(),
  status: z.array(z.enum(TERMINAL_STATUSES)).max(5).optional(),
  state: z.string().max(40).optional(),
  anmId: z.string().uuid().optional(),
  remapped: z.boolean().optional(),
  sort: z.enum(["serialNumber", "tid", "agentName", "state", "anmName", "mappedAt", "lastRemappedAt", "createdAt", "status"]).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(25),
});

const cm = alias(terminalMappings, "cm");

export function terminalFilters(f: z.infer<typeof terminalSearchSchema>): SQL[] {
  const conds: SQL[] = [];
  if (f.q?.trim()) {
    const esc = (s: string) => s.replace(/[\\%_]/g, (m) => "\\" + m);
    const idLike = `%${esc(normalizeIdentifier(f.q))}%`;
    const like = `%${esc(f.q.trim())}%`;
    conds.push(or(ilike(terminals.serialNumber, idLike), ilike(terminals.tid, idLike), ilike(terminals.iswTid, idLike), ilike(cm.agentName, like), ilike(cm.anmName, like), ilike(terminals.legacyAgentName, like))!);
  }
  if (f.accountNumber?.trim()) {
    const acct = normalizeAccount(f.accountNumber);
    if (/^\d{10}$/.test(acct)) {
      conds.push(sql`${cm.agentId} in (select id from agents where account_hash = ${hmac(acct)})`);
    } else if (/^\d{4}$/.test(acct)) conds.push(eq(cm.accountLast4, acct));
    else conds.push(sql`false`);
  }
  if (f.status?.length) conds.push(inArray(terminals.status, f.status));
  if (f.state) conds.push(eq(cm.state, f.state));
  if (f.anmId) conds.push(eq(cm.anmId, f.anmId));
  if (f.remapped === true) conds.push(sql`${terminals.lastRemappedAt} is not null`);
  return conds;
}

export async function searchTerminals(actor: Actor, input: unknown) {
  requireView(actor);
  const parsed = terminalSearchSchema.safeParse(input ?? {});
  if (!parsed.success) throw new AppError("VALIDATION", "Invalid search.", fieldErrors(parsed.error));
  const f = parsed.data;
  const db = getDb();
  const conds = terminalFilters(f);
  // Field submitters only see terminal identity + status, not merchant details of others.
  const where = conds.length ? and(...conds) : undefined;
  const sortCol = {
    serialNumber: terminals.serialNumber,
    tid: terminals.tid,
    agentName: cm.agentName,
    state: cm.state,
    anmName: cm.anmName,
    mappedAt: terminals.mappedAt,
    lastRemappedAt: terminals.lastRemappedAt,
    createdAt: terminals.createdAt,
    status: terminals.status,
  }[f.sort];
  const base = db.select({ total: sql<number>`count(*)::int` }).from(terminals).leftJoin(cm, eq(cm.id, terminals.currentMappingId)).where(where);
  const [{ total }] = await base;
  const rows = await db
    .select({
      id: terminals.id,
      serialNumber: terminals.serialNumber,
      tid: terminals.tid,
      iswTid: terminals.iswTid,
      status: terminals.status,
      agentName: cm.agentName,
      accountLast4: cm.accountLast4,
      state: cm.state,
      area: cm.area,
      anmName: cm.anmName,
      version: cm.version,
      mappedAt: terminals.mappedAt,
      lastRemappedAt: terminals.lastRemappedAt,
      stockLocation: terminals.stockLocation,
      legacyStatus: terminals.legacyStatus,
      legacyAgentName: terminals.legacyAgentName,
      createdAt: terminals.createdAt,
    })
    .from(terminals)
    .leftJoin(cm, eq(cm.id, terminals.currentMappingId))
    .where(where)
    .orderBy(f.dir === "asc" ? sql`${sortCol} asc nulls last` : sql`${sortCol} desc nulls last`, desc(terminals.id))
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);
  const limited = actor.role === "FIELD_SUBMITTER";
  return {
    total,
    page: f.page,
    pageSize: f.pageSize,
    rows: rows.map((r) => ({
      ...r,
      account: limited ? "—" : maskAccount(r.accountLast4),
      accountLast4: undefined,
    })),
  };
}

/**
 * Look up a terminal by serial or TID for the remapping workflow, returning the current mapping
 * and whether it can be remapped right now.
 */
export async function lookupForRemap(actor: Actor, identifier: string) {
  if (!can(actor.role, "request:create")) throw forbidden();
  const id = normalizeIdentifier(identifier);
  if (!id) throw new AppError("VALIDATION", "Enter a terminal serial number or TID.");
  const db = getDb();
  const [t] = await db
    .select()
    .from(terminals)
    .where(or(eq(terminals.serialNumber, id), eq(terminals.tid, id)))
    .limit(1);
  if (!t) throw new AppError("NOT_FOUND", `No terminal found with serial number or TID "${id}".`);
  const [open] = await db
    .select({ id: requests.id, reference: requests.reference, type: requests.type, status: requests.status, createdBy: requests.createdBy })
    .from(requests)
    .where(and(eq(requests.terminalId, t.id), inArray(requests.status, OPEN_STATUSES)));
  let current = null;
  if (t.currentMappingId) {
    const [m] = await db.select().from(terminalMappings).where(eq(terminalMappings.id, t.currentMappingId));
    current = {
      version: m.version,
      agentName: m.agentName,
      account: maskAccount(m.accountLast4),
      state: m.state,
      area: m.area,
      anmId: m.anmId,
      anmName: m.anmName,
      effectiveFrom: m.effectiveFrom,
    };
  }
  let blocker: string | null = null;
  if (open) blocker = `This terminal already has a pending ${open.type === "MAPPING" ? "mapping" : "remapping"} request (${open.reference}).`;
  else if (!current) blocker = "This terminal has no active mapping yet. Use New Mapping instead.";
  else if (t.status === "INACTIVE") blocker = "This terminal is inactive.";
  return {
    terminal: {
      id: t.id,
      serialNumber: t.serialNumber,
      tid: t.tid,
      iswTid: t.iswTid,
      status: t.status,
      // From the vendor sheet — used to pre-fill a new mapping.
      legacyAgentName: t.legacyAgentName,
      legacyStatus: t.legacyStatus,
      stockLocation: t.stockLocation,
      stockState: normalizeState(t.stockLocation),
    },
    current,
    openRequest: open && (can(actor.role, "request:view_all") || open.createdBy === actor.id) ? { id: open.id, reference: open.reference } : open ? { id: null, reference: open.reference } : null,
    blocker,
  };
}

const requester = alias(users, "requester");
const treater = alias(users, "treater");

/** Full lifecycle of a terminal: all mapping versions + all requests. */
export async function getTerminalDetail(actor: Actor, id: string) {
  requireView(actor);
  if (!z.string().uuid().safeParse(id).success) throw notFound("Terminal");
  const db = getDb();
  const [t] = await db
    .select({ t: terminals, vendorName: vendors.name })
    .from(terminals)
    .leftJoin(vendors, eq(vendors.id, terminals.vendorId))
    .where(eq(terminals.id, id));
  if (!t) throw notFound("Terminal");
  const limited = actor.role === "FIELD_SUBMITTER";
  const mappings = await db
    .select({
      id: terminalMappings.id,
      version: terminalMappings.version,
      agentName: terminalMappings.agentName,
      accountLast4: terminalMappings.accountLast4,
      state: terminalMappings.state,
      area: terminalMappings.area,
      anmName: terminalMappings.anmName,
      isCurrent: terminalMappings.isCurrent,
      effectiveFrom: terminalMappings.effectiveFrom,
      effectiveTo: terminalMappings.effectiveTo,
      requestId: terminalMappings.requestId,
      requestReference: requests.reference,
      requestType: requests.type,
      reason: requests.reason,
      requestedBy: requester.fullName,
      requestedAt: requests.createdAt,
      submittedAt: requests.submittedAt,
      treatedBy: treater.fullName,
      treatedAt: requests.treatedAt,
      treatmentComment: requests.treatmentComment,
    })
    .from(terminalMappings)
    .leftJoin(requests, eq(requests.id, terminalMappings.requestId))
    .leftJoin(requester, eq(requester.id, requests.createdBy))
    .leftJoin(treater, eq(treater.id, requests.treatedBy))
    .where(eq(terminalMappings.terminalId, id))
    .orderBy(desc(terminalMappings.version));
  const reqs = await db
    .select({
      id: requests.id,
      reference: requests.reference,
      type: requests.type,
      status: requests.status,
      agentName: requests.agentName,
      createdAt: requests.createdAt,
      treatedAt: requests.treatedAt,
      exceptionReason: requests.exceptionReason,
      createdBy: requests.createdBy,
      requestedBy: requester.fullName,
    })
    .from(requests)
    .leftJoin(requester, eq(requester.id, requests.createdBy))
    .where(eq(requests.terminalId, id))
    .orderBy(desc(requests.createdAt));
  return {
    terminal: { ...t.t, vendorName: t.vendorName, extraIdentifiers: t.t.extraIdentifiers ?? {} },
    mappings: limited
      ? []
      : mappings.map((m) => ({ ...m, account: maskAccount(m.accountLast4), accountLast4: undefined })),
    requests: reqs
      .filter((r) => !limited || r.createdBy === actor.id)
      .map((r) => ({ ...r, createdBy: undefined })),
  };
}

const terminalEditSchema = z.object({
  iswTid: optionalTidSchema,
  status: z.enum(["ACTIVE", "INACTIVE"]).optional(),
  legacyComment: z.string().max(1000).optional().nullable(),
});

export async function updateTerminal(actor: Actor, id: string, input: unknown) {
  if (!can(actor.role, "terminal:manage")) throw forbidden();
  const parsed = terminalEditSchema.safeParse(input);
  if (!parsed.success) throw new AppError("VALIDATION", "Please correct the highlighted fields.", fieldErrors(parsed.error));
  const d = parsed.data;
  const db = getDb();
  try {
    return await db.transaction(async (tx) => {
      const [t] = await tx.select().from(terminals).where(eq(terminals.id, id)).for("update");
      if (!t) throw notFound("Terminal");
      const patch: Partial<typeof terminals.$inferInsert> = { updatedAt: new Date() };
      if (d.iswTid !== undefined) patch.iswTid = d.iswTid;
      if (d.legacyComment !== undefined) patch.legacyComment = d.legacyComment;
      if (d.status === "INACTIVE") {
        const [open] = await tx.select({ id: requests.id }).from(requests).where(and(eq(requests.terminalId, id), inArray(requests.status, OPEN_STATUSES)));
        if (open) throw new AppError("CONFLICT", "This terminal has an open request; cancel it before deactivating.");
        patch.status = "INACTIVE";
      } else if (d.status === "ACTIVE" && t.status === "INACTIVE") {
        patch.status = t.currentMappingId ? "MAPPED" : "AVAILABLE";
      }
      const [u] = await tx.update(terminals).set(patch).where(eq(terminals.id, id)).returning();
      await writeAudit(tx, actor, {
        action: "TERMINAL_UPDATED",
        entityType: "terminal",
        entityId: id,
        entityLabel: t.serialNumber,
        oldValue: { iswTid: t.iswTid, status: t.status, legacyComment: t.legacyComment },
        newValue: { iswTid: u.iswTid, status: u.status, legacyComment: u.legacyComment },
      });
      return u;
    });
  } catch (e) {
    throw fromDbError(e) ?? e;
  }
}

export async function terminalStatusCounts() {
  const db = getDb();
  return db.select({ status: terminals.status, n: sql<number>`count(*)::int` }).from(terminals).groupBy(terminals.status).orderBy(asc(terminals.status));
}
