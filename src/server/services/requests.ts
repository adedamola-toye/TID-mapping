import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getDb, type DbOrTx, type Tx } from "../db/client";
import { anms, terminalMappings, terminals, requests, users, vendors, workflowEvents, agents } from "../db/schema";
import { writeAudit } from "../audit";
import { decrypt, hmac, protectAccount } from "../crypto";
import { AppError, conflict, forbidden, fromDbError, invalidState, notFound } from "../errors";
import type { Actor } from "../actor";
import { can, isInternal } from "../rbac";
import { config } from "../config";
import { TRANSITIONS, canTransition, nextStatus, transitionError, type WorkflowAction } from "../workflow/stateMachine";
import { notifyRoles, notifyUsers, notifyVendor } from "../notifications";
import {
  EDITABLE_STATUSES,
  EXCEPTION_REASON_LABELS,
  OPEN_STATUSES,
  PRIORITIES,
  REQUEST_STATUSES,
  REQUEST_TYPES,
  VENDOR_ACTIONABLE_STATUSES,
  VENDOR_VISIBLE_STATUSES,
  type RequestStatus,
  type RequestType,
} from "@/lib/constants";
import {
  exceptionInputSchema,
  fieldErrors,
  isValidTid,
  mappingInputSchema,
  nubanCheckDigitValid,
  remappingInputSchema,
  normalizeAccount,
  normalizeIdentifier,
} from "@/lib/validation";
import { maskAccount } from "@/lib/format";
import { z } from "zod";

type RequestRow = typeof requests.$inferSelect;

/* ───────────────────────────── helpers ───────────────────────────── */

function vErr(err: z.ZodError): AppError {
  return new AppError("VALIDATION", "Please correct the highlighted fields.", fieldErrors(err));
}

/** Server-only checks on top of the shared schema. */
function serverChecks(data: { accountNumber?: string; tid?: string; iswTid?: string | null }): Record<string, string> {
  const cfg = config();
  const errs: Record<string, string> = {};
  if (data.accountNumber && cfg.NUBAN_BANK_CODE && !nubanCheckDigitValid(data.accountNumber, cfg.NUBAN_BANK_CODE)) {
    errs.accountNumber = "This is not a valid account number for the bank (NUBAN check failed).";
  }
  if (data.tid && !isValidTid(data.tid, cfg.TID_PATTERN)) errs.tid = "TID format is not valid.";
  if (data.iswTid && !isValidTid(data.iswTid, cfg.TID_PATTERN)) errs.iswTid = "ISW TID format is not valid.";
  return errs;
}

async function nextReference(tx: DbOrTx, type: RequestType): Promise<string> {
  const res = await tx.execute(sql`select nextval('request_ref_seq')::bigint as n`);
  const n = Number((res.rows[0] as { n: string }).n);
  return `WKL-${type === "MAPPING" ? "MAP" : "REM"}-${String(n).padStart(6, "0")}`;
}

async function resolveActiveAnm(tx: DbOrTx, anmId: string) {
  const [a] = await tx.select().from(anms).where(eq(anms.id, anmId));
  if (!a || !a.isActive) {
    throw new AppError("VALIDATION", "Select an active ANM from the approved list.", { anmId: "Select an active ANM from the approved list." });
  }
  return a;
}

async function defaultVendorId(tx: DbOrTx): Promise<string> {
  const code = process.env.DEFAULT_VENDOR_CODE ?? "ELNEXU";
  const [v] = await tx.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.code, code), eq(vendors.isActive, true)));
  if (v) return v.id;
  const [any] = await tx.select({ id: vendors.id }).from(vendors).where(eq(vendors.isActive, true)).orderBy(asc(vendors.createdAt)).limit(1);
  if (!any) throw new AppError("BAD_REQUEST", "No active vendor is configured. Ask an administrator to set up the vendor.");
  return any.id;
}

async function upsertAgent(tx: DbOrTx, name: string, accountNumber: string): Promise<string> {
  const p = protectAccount(accountNumber);
  const [existing] = await tx
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.accountHash, p.accountHash), eq(agents.name, name)));
  if (existing) return existing.id;
  const [row] = await tx
    .insert(agents)
    .values({ name, ...p })
    .onConflictDoUpdate({ target: [agents.accountHash, agents.name], set: { updatedAt: new Date() } })
    .returning({ id: agents.id });
  return row.id;
}

function actorName(a: Actor) {
  return a.fullName;
}

async function addEvent(
  tx: DbOrTx,
  req: Pick<RequestRow, "id">,
  actor: Actor,
  action: string,
  from: RequestStatus | null,
  to: RequestStatus | null,
  comment?: string | null,
  details?: Record<string, unknown>,
  vendorVisible = true,
) {
  await tx.insert(workflowEvents).values({
    requestId: req.id,
    action,
    fromStatus: from,
    toStatus: to,
    actorId: actor.id,
    actorName: actorName(actor),
    actorRole: actor.role,
    comment: comment ?? null,
    details: details ?? null,
    vendorVisible,
  });
}

/** Access check: can this actor see this request at all? (IDOR guard) */
export function canView(actor: Actor, r: Pick<RequestRow, "createdBy" | "vendorId" | "status">): boolean {
  if (actor.role === "VENDOR_USER") {
    return !!actor.vendorId && r.vendorId === actor.vendorId && VENDOR_VISIBLE_STATUSES.includes(r.status);
  }
  if (can(actor.role, "request:view_all")) return true;
  return can(actor.role, "request:view_own") && r.createdBy === actor.id;
}

function assertAction(actor: Actor, action: WorkflowAction, r: RequestRow) {
  const rule = TRANSITIONS[action];
  if (!canView(actor, r)) throw notFound("Request");
  if (!can(actor.role, rule.permission)) throw forbidden();
  if (rule.vendor && (actor.role !== "VENDOR_USER" || r.vendorId !== actor.vendorId)) throw forbidden();
  // Field submitters may only touch their own requests.
  if (!can(actor.role, "request:view_all") && !rule.vendor && r.createdBy !== actor.id) throw forbidden();
  if (!canTransition(action, r.status)) throw invalidState(transitionError(action, r.status));
}

async function lockRequest(tx: Tx, id: string): Promise<RequestRow> {
  const [r] = await tx.select().from(requests).where(eq(requests.id, id)).for("update");
  if (!r) throw notFound("Request");
  return r;
}

async function runTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  try {
    return await getDb().transaction(fn);
  } catch (e) {
    if (e instanceof AppError) throw e;
    const mapped = fromDbError(e);
    if (mapped) throw mapped;
    throw e;
  }
}

/** Terminal identifiers & ANM snapshot used for audit/vendor payloads. */
function snapshot(r: Pick<RequestRow, "serialNumber" | "tid" | "iswTid" | "agentName" | "accountLast4" | "state" | "area" | "anmName" | "priority">) {
  return {
    serialNumber: r.serialNumber,
    tid: r.tid,
    iswTid: r.iswTid,
    agentName: r.agentName,
    account: maskAccount(r.accountLast4),
    state: r.state,
    area: r.area,
    anm: r.anmName,
    priority: r.priority,
  };
}

/* ───────────────────────────── create: new mapping ───────────────────────────── */

export interface CreateOptions {
  /** Create directly as READY_FOR_REVIEW (default) or keep as DRAFT. */
  asDraft?: boolean;
  batchId?: string | null;
}

export async function createMappingRequest(actor: Actor, input: unknown, opts: CreateOptions = {}, txIn?: Tx) {
  if (!can(actor.role, "request:create")) throw forbidden();
  const parsed = mappingInputSchema.safeParse(input);
  if (!parsed.success) throw vErr(parsed.error);
  const d = parsed.data;
  const sErr = serverChecks(d);
  if (Object.keys(sErr).length) throw new AppError("VALIDATION", "Please correct the highlighted fields.", sErr);

  const work = async (tx: Tx) => {
    const anm = await resolveActiveAnm(tx, d.anmId);

    // Lock / resolve the terminal by serial.
    let [terminal] = await tx.select().from(terminals).where(eq(terminals.serialNumber, d.serialNumber)).for("update");
    const [tidOwner] = await tx.select().from(terminals).where(eq(terminals.tid, d.tid));
    if (tidOwner && (!terminal || tidOwner.id !== terminal.id)) {
      throw new AppError("CONFLICT", `TID ${d.tid} is already assigned to terminal ${tidOwner.serialNumber}.`, { tid: "This TID is already assigned to another terminal." });
    }
    if (terminal) {
      if (terminal.status === "INACTIVE") throw conflict("This terminal is marked inactive and cannot be mapped.");
      if (terminal.tid && terminal.tid !== d.tid) {
        throw new AppError("CONFLICT", `Serial ${d.serialNumber} is registered with TID ${terminal.tid}, not ${d.tid}.`, { tid: `This terminal is registered with TID ${terminal.tid}.` });
      }
      const [open] = await tx
        .select({ reference: requests.reference, type: requests.type })
        .from(requests)
        .where(and(eq(requests.terminalId, terminal.id), inArray(requests.status, OPEN_STATUSES)));
      if (open) {
        throw conflict(`This terminal already has a pending ${open.type === "MAPPING" ? "mapping" : "remapping"} request (${open.reference}).`);
      }
      if (terminal.currentMappingId) {
        throw conflict("This terminal already has an active mapping. Use Terminal Remapping to change its agent.");
      }
      const patch: Partial<typeof terminals.$inferInsert> = { status: "MAPPING_PENDING", updatedAt: new Date() };
      if (!terminal.tid) patch.tid = d.tid;
      if (d.iswTid && !terminal.iswTid) patch.iswTid = d.iswTid;
      [terminal] = await tx.update(terminals).set(patch).where(eq(terminals.id, terminal.id)).returning();
    } else {
      [terminal] = await tx
        .insert(terminals)
        .values({
          serialNumber: d.serialNumber,
          tid: d.tid,
          iswTid: d.iswTid,
          status: "MAPPING_PENDING",
          vendorId: await defaultVendorId(tx),
          createdBy: actor.id,
        })
        .returning();
      await writeAudit(tx, actor, {
        action: "TERMINAL_CREATED",
        entityType: "terminal",
        entityId: terminal.id,
        entityLabel: terminal.serialNumber,
        newValue: { serialNumber: terminal.serialNumber, tid: terminal.tid, iswTid: terminal.iswTid },
      });
    }

    const status: RequestStatus = opts.asDraft ? "DRAFT" : "READY_FOR_REVIEW";
    const [r] = await tx
      .insert(requests)
      .values({
        reference: await nextReference(tx, "MAPPING"),
        type: "MAPPING",
        status,
        priority: d.priority,
        terminalId: terminal.id,
        serialNumber: terminal.serialNumber,
        tid: d.tid,
        iswTid: d.iswTid ?? terminal.iswTid,
        agentName: d.agentName,
        ...protectAccount(d.accountNumber),
        state: d.state,
        area: d.area,
        anmId: anm.id,
        anmName: anm.fullName,
        internalComment: d.internalComment,
        vendorId: terminal.vendorId ?? (await defaultVendorId(tx)),
        batchId: opts.batchId ?? null,
        createdBy: actor.id,
      })
      .returning();
    await addEvent(tx, r, actor, "CREATED", null, status, d.internalComment, undefined, false);
    await writeAudit(tx, actor, {
      action: "REQUEST_CREATED",
      entityType: "request",
      entityId: r.id,
      entityLabel: r.reference,
      newValue: { type: "MAPPING", status, ...snapshot(r) },
    });
    return r;
  };
  return txIn ? work(txIn) : runTx(work);
}

/* ───────────────────────────── create: remapping ───────────────────────────── */

export async function createRemappingRequest(actor: Actor, input: unknown, opts: CreateOptions = {}, txIn?: Tx) {
  if (!can(actor.role, "request:create")) throw forbidden();
  // Serial / TID are not editable on remap. If a client echoes them back, they must match the
  // terminal exactly (checked below) — any difference requires a new mapping workflow.
  const parsed = remappingInputSchema.safeParse(input);
  if (!parsed.success) throw vErr(parsed.error);
  const d = parsed.data;
  const sErr = serverChecks(d);
  if (Object.keys(sErr).length) throw new AppError("VALIDATION", "Please correct the highlighted fields.", sErr);

  const work = async (tx: Tx) => {
    const anm = await resolveActiveAnm(tx, d.anmId);
    const [terminal] = await tx.select().from(terminals).where(eq(terminals.id, d.terminalId)).for("update");
    if (!terminal) throw notFound("Terminal");

    const i = input as Record<string, unknown>;
    if (i.serialNumber !== undefined && normalizeIdentifier(i.serialNumber) !== terminal.serialNumber) {
      throw new AppError("VALIDATION", "Serial number cannot change during a remapping. Create a new mapping instead.", { serialNumber: "Serial number cannot change during remapping." });
    }
    if (i.tid !== undefined && normalizeIdentifier(i.tid) !== terminal.tid) {
      throw new AppError("VALIDATION", "TID cannot change during a remapping. Create a new mapping instead.", { tid: "TID cannot change during remapping." });
    }

    const [open] = await tx
      .select({ reference: requests.reference, type: requests.type })
      .from(requests)
      .where(and(eq(requests.terminalId, terminal.id), inArray(requests.status, OPEN_STATUSES)));
    if (open) {
      throw conflict(`This terminal already has a pending ${open.type === "MAPPING" ? "mapping" : "remapping"} request (${open.reference}).`);
    }
    if (!terminal.currentMappingId || !terminal.tid) {
      throw conflict("This terminal has no active mapping yet. Use New Mapping instead of remapping.");
    }
    const [current] = await tx.select().from(terminalMappings).where(eq(terminalMappings.id, terminal.currentMappingId));
    const currentAccount = decrypt(current.accountEnc);
    if (
      current.agentName === d.agentName &&
      currentAccount === d.accountNumber &&
      current.state === d.state &&
      (current.area ?? null) === (d.area ?? null) &&
      current.anmId === anm.id
    ) {
      throw new AppError("VALIDATION", "The new mapping is identical to the current mapping. Change at least one field.");
    }

    await tx.update(terminals).set({ status: "REMAPPING_PENDING", updatedAt: new Date() }).where(eq(terminals.id, terminal.id));
    const status: RequestStatus = opts.asDraft ? "DRAFT" : "READY_FOR_REVIEW";
    const [r] = await tx
      .insert(requests)
      .values({
        reference: await nextReference(tx, "REMAPPING"),
        type: "REMAPPING",
        status,
        priority: d.priority,
        terminalId: terminal.id,
        serialNumber: terminal.serialNumber,
        tid: terminal.tid,
        iswTid: terminal.iswTid,
        agentName: d.agentName,
        ...protectAccount(d.accountNumber),
        state: d.state,
        area: d.area,
        anmId: anm.id,
        anmName: anm.fullName,
        previousMappingId: current.id,
        reason: d.reason,
        internalComment: d.internalComment,
        vendorId: terminal.vendorId ?? (await defaultVendorId(tx)),
        batchId: opts.batchId ?? null,
        createdBy: actor.id,
      })
      .returning();
    await addEvent(tx, r, actor, "CREATED", null, status, d.reason, undefined, false);
    await writeAudit(tx, actor, {
      action: "REQUEST_CREATED",
      entityType: "request",
      entityId: r.id,
      entityLabel: r.reference,
      oldValue: { mappingVersion: current.version, agentName: current.agentName, account: maskAccount(current.accountLast4), state: current.state, anm: current.anmName },
      newValue: { type: "REMAPPING", status, reason: d.reason, ...snapshot(r) },
    });
    return r;
  };
  return txIn ? work(txIn) : runTx(work);
}

/* ───────────────────────────── edit (pre-release) & amend (post-release) ───────────────────────────── */

const editSchema = z.object({
  agentName: mappingInputSchema.shape.agentName.optional(),
  accountNumber: mappingInputSchema.shape.accountNumber.optional(),
  state: mappingInputSchema.shape.state.optional(),
  area: mappingInputSchema.shape.area,
  anmId: mappingInputSchema.shape.anmId.optional(),
  priority: z.enum(PRIORITIES).optional(),
  internalComment: mappingInputSchema.shape.internalComment,
  iswTid: mappingInputSchema.shape.iswTid,
  serialNumber: mappingInputSchema.shape.serialNumber.optional(),
  tid: mappingInputSchema.shape.tid.optional(),
  reason: z.string().max(500).optional(),
  expectedVersion: z.number().int().optional(),
});

async function applyFieldChanges(tx: Tx, actor: Actor, r: RequestRow, d: z.infer<typeof editSchema>, allowIdentifiers: boolean) {
  const patch: Partial<typeof requests.$inferInsert> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const track = (k: string, oldV: unknown, newV: unknown) => {
    before[k] = oldV;
    after[k] = newV;
  };

  if (d.agentName !== undefined && d.agentName !== r.agentName) {
    patch.agentName = d.agentName;
    track("agentName", r.agentName, d.agentName);
  }
  if (d.accountNumber !== undefined && hmac(d.accountNumber) !== r.accountHash) {
    Object.assign(patch, protectAccount(d.accountNumber));
    track("account", maskAccount(r.accountLast4), maskAccount(d.accountNumber.slice(-4)));
  }
  if (d.state !== undefined && d.state !== r.state) {
    patch.state = d.state;
    track("state", r.state, d.state);
  }
  if (d.area !== undefined && (d.area ?? null) !== (r.area ?? null)) {
    patch.area = d.area;
    track("area", r.area, d.area);
  }
  if (d.anmId !== undefined && d.anmId !== r.anmId) {
    const anm = await resolveActiveAnm(tx, d.anmId);
    patch.anmId = anm.id;
    patch.anmName = anm.fullName;
    track("anm", r.anmName, anm.fullName);
  }
  if (d.priority !== undefined && d.priority !== r.priority) {
    patch.priority = d.priority;
    track("priority", r.priority, d.priority);
  }
  if (d.internalComment !== undefined && (d.internalComment ?? null) !== (r.internalComment ?? null)) {
    patch.internalComment = d.internalComment;
    track("internalComment", r.internalComment, d.internalComment);
  }

  const idChange =
    (d.serialNumber !== undefined && d.serialNumber !== r.serialNumber) ||
    (d.tid !== undefined && d.tid !== r.tid) ||
    (d.iswTid !== undefined && (d.iswTid ?? null) !== (r.iswTid ?? null));
  if (idChange) {
    if (r.type === "REMAPPING") {
      throw new AppError("VALIDATION", "Serial number and TID cannot change during a remapping. Create a new mapping instead.");
    }
    if (!allowIdentifiers) {
      throw new AppError("VALIDATION", "Terminal identifiers cannot be amended after release to the vendor. Cancel this request and create a new one.");
    }
    // Only correct identifiers if the terminal record was created for this request and has no history.
    const [t] = await tx.select().from(terminals).where(eq(terminals.id, r.terminalId)).for("update");
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(requests)
      .where(and(eq(requests.terminalId, t.id), sql`${requests.id} <> ${r.id}`));
    if (t.currentMappingId || n > 0) {
      throw new AppError("VALIDATION", "This terminal already has history; its serial/TID cannot be corrected here. Cancel and create a new request.");
    }
    const newSerial = d.serialNumber ?? r.serialNumber;
    const newTid = d.tid ?? r.tid;
    const newIsw = d.iswTid !== undefined ? d.iswTid : r.iswTid;
    const sErr = serverChecks({ tid: newTid, iswTid: newIsw });
    if (Object.keys(sErr).length) throw new AppError("VALIDATION", "Please correct the highlighted fields.", sErr);
    await tx.update(terminals).set({ serialNumber: newSerial, tid: newTid, iswTid: newIsw, updatedAt: new Date() }).where(eq(terminals.id, t.id));
    patch.serialNumber = newSerial;
    patch.tid = newTid;
    patch.iswTid = newIsw;
    track("terminal", { serialNumber: r.serialNumber, tid: r.tid, iswTid: r.iswTid }, { serialNumber: newSerial, tid: newTid, iswTid: newIsw });
  }
  return { patch, before, after };
}

export async function updateRequest(actor: Actor, id: string, input: unknown) {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) throw vErr(parsed.error);
  const d = parsed.data;
  if (d.accountNumber) {
    const s = serverChecks({ accountNumber: d.accountNumber });
    if (Object.keys(s).length) throw new AppError("VALIDATION", "Please correct the highlighted fields.", s);
  }
  return runTx(async (tx) => {
    const r = await lockRequest(tx, id);
    assertAction(actor, "UPDATE", r);
    if (d.expectedVersion !== undefined && d.expectedVersion !== r.rowVersion) {
      throw conflict("This request was changed by someone else. Reload to see the latest version.");
    }
    const { patch, before, after } = await applyFieldChanges(tx, actor, r, d, true);
    if (Object.keys(patch).length === 0) return r;
    const [u] = await tx
      .update(requests)
      .set({ ...patch, rowVersion: r.rowVersion + 1, updatedAt: new Date() })
      .where(eq(requests.id, id))
      .returning();
    await addEvent(tx, r, actor, "UPDATED", r.status, r.status, null, { before, after }, false);
    await writeAudit(tx, actor, { action: "REQUEST_UPDATED", entityType: "request", entityId: id, entityLabel: r.reference, oldValue: before, newValue: after });
    return u;
  });
}

/** Controlled amendment after release to the vendor — requires a reason, notifies the vendor. */
export async function amendRequest(actor: Actor, id: string, input: unknown) {
  const parsed = editSchema.safeParse(input);
  if (!parsed.success) throw vErr(parsed.error);
  const d = parsed.data;
  const reason = (d.reason ?? "").trim();
  if (reason.length < 3) throw new AppError("VALIDATION", "An amendment reason is required.", { reason: "An amendment reason is required." });
  if (d.accountNumber) {
    const s = serverChecks({ accountNumber: d.accountNumber });
    if (Object.keys(s).length) throw new AppError("VALIDATION", "Please correct the highlighted fields.", s);
  }
  return runTx(async (tx) => {
    const r = await lockRequest(tx, id);
    if (r.status === "IN_PROGRESS") {
      throw invalidState("The vendor is currently treating this request. Ask the vendor to release it or raise an exception before amending.");
    }
    assertAction(actor, "AMEND", r);
    if (d.expectedVersion !== undefined && d.expectedVersion !== r.rowVersion) {
      throw conflict("This request was changed by someone else. Reload to see the latest version.");
    }
    const { patch, before, after } = await applyFieldChanges(tx, actor, r, d, false);
    if (Object.keys(patch).length === 0) throw new AppError("VALIDATION", "No changes to amend.");
    const [u] = await tx
      .update(requests)
      .set({ ...patch, rowVersion: r.rowVersion + 1, updatedAt: new Date() })
      .where(eq(requests.id, id))
      .returning();
    const vendorBefore = { ...before };
    const vendorAfter = { ...after };
    delete vendorBefore.internalComment;
    delete vendorAfter.internalComment;
    await addEvent(tx, r, actor, "AMENDED", r.status, r.status, reason, { before: vendorBefore, after: vendorAfter }, true);
    await writeAudit(tx, actor, { action: "REQUEST_AMENDED", entityType: "request", entityId: id, entityLabel: r.reference, oldValue: before, newValue: { ...after, reason } });
    await notifyVendor(tx, r.vendorId, {
      kind: "REQUEST_AMENDED",
      title: `Request ${r.reference} (terminal ${r.serialNumber}) was amended by Wakeel`,
      body: `Please use the updated details. Reason: ${reason}`,
      link: `/vendor/requests/${r.id}`,
    });
    return u;
  });
}

/* ───────────────────────────── transitions ───────────────────────────── */

interface TransitionResult {
  request: RequestRow;
}

async function simpleTransition(
  actor: Actor,
  id: string,
  action: WorkflowAction,
  build: (r: RequestRow, tx: Tx) => Promise<{ patch?: Partial<typeof requests.$inferInsert>; comment?: string | null; audit?: Record<string, unknown>; eventVendorVisible?: boolean }>,
  txIn?: Tx,
): Promise<TransitionResult> {
  const work = async (tx: Tx) => {
    const r = await lockRequest(tx, id);
    assertAction(actor, action, r);
    const to = nextStatus(action, r.status);
    const { patch = {}, comment = null, audit = {}, eventVendorVisible = true } = await build(r, tx);
    const [u] = await tx
      .update(requests)
      .set({ ...patch, status: to, rowVersion: r.rowVersion + 1, updatedAt: new Date() })
      .where(and(eq(requests.id, id), eq(requests.rowVersion, r.rowVersion)))
      .returning();
    if (!u) throw conflict("Another user changed this request at the same time. Please retry.");
    await addEvent(tx, r, actor, action, r.status, to, comment, undefined, eventVendorVisible);
    await writeAudit(tx, actor, {
      action: `REQUEST_${action}`,
      entityType: "request",
      entityId: id,
      entityLabel: r.reference,
      oldValue: { status: r.status },
      newValue: { status: to, ...(comment ? { comment } : {}), ...audit },
    });
    return { request: u };
  };
  return txIn ? work(txIn) : runTx(work);
}

export async function markReady(actor: Actor, id: string) {
  return simpleTransition(actor, id, "MARK_READY", async () => ({ eventVendorVisible: false }));
}

/** Release to the vendor after the internal review confirmation. */
export async function submitToVendor(actor: Actor, id: string, confirm: boolean, opts: { notify?: boolean } = {}) {
  if (confirm !== true) {
    throw new AppError("VALIDATION", "Please confirm you have reviewed the information and it is ready for vendor treatment.");
  }
  const res = await simpleTransition(actor, id, "SUBMIT_TO_VENDOR", async (r) => {
    const now = new Date();
    return {
      patch: { submittedBy: actor.id, submittedAt: now, firstSubmittedAt: r.firstSubmittedAt ?? now, reviewedBy: actor.id, reviewedAt: now },
      comment: "Reviewed and confirmed ready for vendor treatment.",
      audit: { confirmation: "I have reviewed the information and it is ready for vendor treatment." },
    };
  });
  if (opts.notify !== false) {
    await notifyVendor(getDb(), res.request.vendorId, {
      kind: "VENDOR_NEW_REQUESTS",
      title: `1 new terminal ${res.request.type === "MAPPING" ? "mapping" : "remapping"} request is awaiting treatment`,
      body: `${res.request.reference} — terminal ${res.request.serialNumber} / TID ${res.request.tid}`,
      link: `/vendor/requests/${res.request.id}`,
    });
  }
  return res;
}

export async function resubmit(actor: Actor, id: string, comment: string | null) {
  const res = await simpleTransition(actor, id, "RESUBMIT", async () => ({
    patch: { submittedBy: actor.id, submittedAt: new Date(), exceptionReason: null, exceptionComment: null },
    comment: comment || "Resubmitted to vendor after exception review.",
  }));
  await notifyVendor(getDb(), res.request.vendorId, {
    kind: "VENDOR_RESUBMITTED",
    title: `${res.request.reference} has been resubmitted for treatment`,
    body: comment ?? undefined,
    link: `/vendor/requests/${res.request.id}`,
  });
  return res;
}

export async function startTreatment(actor: Actor, id: string) {
  return simpleTransition(actor, id, "START", async () => ({
    patch: { vendorAssigneeId: actor.id, startedAt: new Date() },
  }));
}

export async function releaseTreatment(actor: Actor, id: string) {
  // Any user of the same vendor may release a claimed request; the event records who did it.
  return simpleTransition(actor, id, "RELEASE", async () => ({ patch: { vendorAssigneeId: null, startedAt: null } }));
}

/**
 * Vendor confirms the terminal has been mapped/remapped in the TMS.
 * Creates the new mapping version and preserves the previous one.
 */
export async function markTreated(actor: Actor, id: string, confirm: boolean, comment: string | null, opts: { notify?: boolean } = {}) {
  if (confirm !== true) {
    throw new AppError("VALIDATION", "Please confirm that this terminal has been successfully mapped in the TMS.");
  }
  const cleanComment = comment ? comment.trim().slice(0, 1000) : null;
  const res = await runTx(async (tx) => {
    const out = await simpleTransition(
      actor,
      id,
      "TREAT",
      async (r, t) => {
        const now = new Date();
        const [terminal] = await t.select().from(terminals).where(eq(terminals.id, r.terminalId)).for("update");
        if (r.type === "REMAPPING" && terminal.currentMappingId !== r.previousMappingId) {
          throw conflict("The terminal's mapping changed since this remapping was requested. Raise an exception so Wakeel can review.");
        }
        if (r.type === "MAPPING" && terminal.currentMappingId) {
          throw conflict("This terminal already has an active mapping. Raise an exception so Wakeel can review.");
        }
        const [{ maxV }] = await t
          .select({ maxV: sql<number>`coalesce(max(${terminalMappings.version}), 0)::int` })
          .from(terminalMappings)
          .where(eq(terminalMappings.terminalId, terminal.id));
        if (terminal.currentMappingId) {
          await t
            .update(terminalMappings)
            .set({ isCurrent: false, effectiveTo: now })
            .where(eq(terminalMappings.id, terminal.currentMappingId));
        }
        const account = decrypt(r.accountEnc);
        const agentId = await upsertAgent(t, r.agentName, account);
        const [m] = await t
          .insert(terminalMappings)
          .values({
            terminalId: terminal.id,
            version: maxV + 1,
            agentId,
            agentName: r.agentName,
            accountEnc: r.accountEnc,
            accountLast4: r.accountLast4,
            state: r.state,
            area: r.area,
            anmId: r.anmId,
            anmName: r.anmName,
            requestId: r.id,
            isCurrent: true,
            effectiveFrom: now,
          })
          .returning();
        await t
          .update(terminals)
          .set({
            currentMappingId: m.id,
            status: "MAPPED",
            mappedAt: terminal.mappedAt ?? now,
            lastRemappedAt: r.type === "REMAPPING" ? now : terminal.lastRemappedAt,
            updatedAt: now,
          })
          .where(eq(terminals.id, terminal.id));
        if (r.type === "REMAPPING") {
          await writeAudit(t, actor, {
            action: "TERMINAL_REMAPPED",
            entityType: "terminal",
            entityId: terminal.id,
            entityLabel: terminal.serialNumber,
            oldValue: { mappingVersion: maxV },
            newValue: { mappingVersion: maxV + 1, agentName: r.agentName, account: maskAccount(r.accountLast4), state: r.state, anm: r.anmName },
          });
        } else {
          await writeAudit(t, actor, {
            action: "TERMINAL_MAPPED",
            entityType: "terminal",
            entityId: terminal.id,
            entityLabel: terminal.serialNumber,
            newValue: { mappingVersion: maxV + 1, agentName: r.agentName, account: maskAccount(r.accountLast4), state: r.state, anm: r.anmName },
          });
        }
        return {
          patch: {
            treatedBy: actor.id,
            treatedAt: now,
            treatmentComment: cleanComment,
            resultMappingId: m.id,
            vendorAssigneeId: r.vendorAssigneeId ?? actor.id,
            startedAt: r.startedAt ?? now,
          },
          comment: cleanComment,
          audit: { mappingVersion: maxV + 1, confirmation: "Terminal successfully mapped in the TMS." },
        };
      },
      tx,
    );
    return out;
  });
  if (opts.notify !== false) {
    const r = res.request;
    await notifyUsers(getDb(), [r.createdBy, r.submittedBy ?? ""], {
      kind: "REQUEST_TREATED",
      title: `${r.reference} has been treated by the vendor`,
      body: `Terminal ${r.serialNumber} / TID ${r.tid} → ${r.agentName}`,
      link: `/requests/${r.id}`,
    });
  }
  return res;
}

export async function raiseException(actor: Actor, id: string, input: unknown) {
  const parsed = exceptionInputSchema.safeParse(input);
  if (!parsed.success) throw vErr(parsed.error);
  const { reason, comment } = parsed.data;
  const res = await simpleTransition(actor, id, "RAISE_EXCEPTION", async (r) => ({
    patch: {
      exceptionReason: reason,
      exceptionComment: comment,
      exceptionBy: actor.id,
      exceptionAt: new Date(),
      exceptionCount: r.exceptionCount + 1,
      vendorAssigneeId: null,
    },
    comment: `${EXCEPTION_REASON_LABELS[reason]}${comment ? ` — ${comment}` : ""}`,
    audit: { exceptionReason: reason },
  }));
  const r = res.request;
  const db = getDb();
  const msg = {
    kind: "REQUEST_EXCEPTION",
    title: `Terminal ${r.serialNumber} has been returned by the vendor: ${EXCEPTION_REASON_LABELS[reason].toLowerCase()}`,
    body: `${r.reference}${comment ? ` — ${comment}` : ""}`,
    link: `/requests/${r.id}`,
  };
  await notifyUsers(db, [r.createdBy, r.submittedBy ?? ""], msg);
  await notifyRoles(db, ["WAKEEL_ADMIN"], msg, r.submittedBy ?? undefined);
  return res;
}

/** Return to internal correction (from EXCEPTION, or recall from SUBMITTED). */
export async function returnRequest(actor: Actor, id: string, comment: string) {
  const c = (comment ?? "").trim();
  if (c.length < 3) throw new AppError("VALIDATION", "Please explain what needs to be corrected.", { comment: "Required." });
  const res = await simpleTransition(actor, id, "RETURN", async () => ({
    patch: { returnedBy: actor.id, returnedAt: new Date(), returnComment: c.slice(0, 1000) },
    comment: c.slice(0, 1000),
    eventVendorVisible: false,
  }));
  await notifyUsers(getDb(), [res.request.createdBy], {
    kind: "REQUEST_RETURNED",
    title: `${res.request.reference} needs correction`,
    body: c,
    link: `/requests/${res.request.id}`,
  });
  return res;
}

export async function cancelRequest(actor: Actor, id: string, reasonIn: string) {
  const reason = (reasonIn ?? "").trim();
  if (reason.length < 3) throw new AppError("VALIDATION", "A cancellation reason is required.", { reason: "Required." });
  return runTx(async (tx) => {
    const r0 = await lockRequest(tx, id);
    // Field submitters may cancel their own requests only before release.
    if (actor.role === "FIELD_SUBMITTER") {
      if (r0.createdBy !== actor.id) throw notFound("Request");
      if (!["DRAFT", "READY_FOR_REVIEW", "RETURNED"].includes(r0.status)) throw forbidden("Only Wakeel operations can cancel a released request.");
    } else {
      assertAction(actor, "CANCEL", r0);
    }
    if (!canTransition("CANCEL", r0.status)) throw invalidState(transitionError("CANCEL", r0.status));
    const [u] = await tx
      .update(requests)
      .set({ status: "CANCELLED", cancelledBy: actor.id, cancelledAt: new Date(), cancelReason: reason.slice(0, 500), rowVersion: r0.rowVersion + 1, updatedAt: new Date() })
      .where(eq(requests.id, id))
      .returning();
    const [t] = await tx.select().from(terminals).where(eq(terminals.id, r0.terminalId)).for("update");
    await tx
      .update(terminals)
      .set({ status: t.currentMappingId ? "MAPPED" : "AVAILABLE", updatedAt: new Date() })
      .where(eq(terminals.id, t.id));
    await addEvent(tx, r0, actor, "CANCEL", r0.status, "CANCELLED", reason, undefined, true);
    await writeAudit(tx, actor, { action: "REQUEST_CANCEL", entityType: "request", entityId: id, entityLabel: r0.reference, oldValue: { status: r0.status }, newValue: { status: "CANCELLED", reason } });
    if (["SUBMITTED", "EXCEPTION"].includes(r0.status)) {
      await notifyVendor(tx, r0.vendorId, { kind: "REQUEST_CANCELLED", title: `${r0.reference} was cancelled by Wakeel — no TMS action required`, link: `/vendor/requests/${r0.id}` });
    }
    return { request: u };
  });
}

export async function closeRequest(actor: Actor, id: string, comment?: string | null) {
  return simpleTransition(actor, id, "CLOSE", async () => ({
    patch: { closedBy: actor.id, closedAt: new Date() },
    comment: comment ?? null,
    eventVendorVisible: false,
  }));
}

/** Records that a vendor opened a request (first open sets vendor_opened_at). */
export async function recordVendorOpened(actor: Actor, id: string) {
  if (actor.role !== "VENDOR_USER") return;
  await runTx(async (tx) => {
    const [r] = await tx.select().from(requests).where(eq(requests.id, id));
    if (!r || !canView(actor, r)) throw notFound("Request");
    if (!r.vendorOpenedAt && VENDOR_ACTIONABLE_STATUSES.includes(r.status)) {
      await tx.update(requests).set({ vendorOpenedAt: new Date() }).where(and(eq(requests.id, id), isNull(requests.vendorOpenedAt)));
      await addEvent(tx, r, actor, "VENDOR_OPENED", r.status, r.status);
    }
    await writeAudit(tx, actor, { action: "VENDOR_OPENED_REQUEST", entityType: "request", entityId: id, entityLabel: r.reference });
  });
}

export async function recordCopy(actor: Actor, id: string, field: string) {
  const db = getDb();
  const [r] = await db.select().from(requests).where(eq(requests.id, id));
  if (!r || !canView(actor, r)) throw notFound("Request");
  const safeField = String(field ?? "").replace(/[^a-zA-Z_]/g, "").slice(0, 40) || "unknown";
  await writeAudit(db, actor, { action: "VENDOR_COPIED_DATA", entityType: "request", entityId: id, entityLabel: r.reference, newValue: { field: safeField } });
}

/** Reveal a full account number to an authorised internal user (audited). */
export async function revealAccount(actor: Actor, id: string): Promise<string> {
  const db = getDb();
  const [r] = await db.select().from(requests).where(eq(requests.id, id));
  if (!r || !canView(actor, r)) throw notFound("Request");
  const allowed =
    can(actor.role, "account:view_full") ||
    (actor.role === "FIELD_SUBMITTER" && r.createdBy === actor.id) ||
    (actor.role === "VENDOR_USER" && VENDOR_ACTIONABLE_STATUSES.includes(r.status));
  if (!allowed) throw forbidden("You are not authorised to view full account numbers.");
  await writeAudit(db, actor, { action: "ACCOUNT_REVEALED", entityType: "request", entityId: id, entityLabel: r.reference });
  return decrypt(r.accountEnc);
}

/* ───────────────────────────── bulk operations ───────────────────────────── */

export interface BulkResult {
  succeeded: string[];
  failed: { id: string; reference?: string; error: string }[];
}

async function bulk(ids: string[], fn: (id: string) => Promise<unknown>): Promise<BulkResult> {
  const uniq = [...new Set(ids)].slice(0, 500);
  const out: BulkResult = { succeeded: [], failed: [] };
  for (const id of uniq) {
    try {
      await fn(id);
      out.succeeded.push(id);
    } catch (e) {
      const msg = e instanceof AppError ? e.message : "Unexpected error.";
      if (!(e instanceof AppError)) console.error("[bulk]", e);
      out.failed.push({ id, error: msg });
    }
  }
  if (out.failed.length) {
    const refs = await getDb()
      .select({ id: requests.id, reference: requests.reference })
      .from(requests)
      .where(inArray(requests.id, out.failed.map((f) => f.id).filter((x) => z.string().uuid().safeParse(x).success)));
    for (const f of out.failed) f.reference = refs.find((r) => r.id === f.id)?.reference;
  }
  return out;
}

export async function bulkSubmitToVendor(actor: Actor, ids: string[], confirm: boolean) {
  const res = await bulk(ids, (id) => submitToVendor(actor, id, confirm, { notify: false }));
  if (res.succeeded.length) {
    const db = getDb();
    const rows = await db
      .select({ vendorId: requests.vendorId, n: sql<number>`count(*)::int` })
      .from(requests)
      .where(inArray(requests.id, res.succeeded))
      .groupBy(requests.vendorId);
    for (const r of rows) {
      await notifyVendor(db, r.vendorId, {
        kind: "VENDOR_NEW_REQUESTS",
        title: `${r.n} new terminal mapping request${r.n === 1 ? " is" : "s are"} awaiting treatment`,
        link: "/vendor",
      });
    }
  }
  return res;
}

export async function bulkStart(actor: Actor, ids: string[]) {
  return bulk(ids, (id) => startTreatment(actor, id));
}

export async function bulkMarkTreated(actor: Actor, ids: string[], confirm: boolean, comment: string | null) {
  const res = await bulk(ids, (id) => markTreated(actor, id, confirm, comment, { notify: false }));
  if (res.succeeded.length) {
    const db = getDb();
    const rows = await db
      .select({ createdBy: requests.createdBy, submittedBy: requests.submittedBy })
      .from(requests)
      .where(inArray(requests.id, res.succeeded));
    const counts = new Map<string, number>();
    for (const r of rows) {
      for (const u of new Set([r.createdBy, r.submittedBy].filter(Boolean) as string[])) counts.set(u, (counts.get(u) ?? 0) + 1);
    }
    const vendorName = actor.vendorId
      ? (await db.select({ name: vendors.name }).from(vendors).where(eq(vendors.id, actor.vendorId)))[0]?.name ?? "the vendor"
      : "the vendor";
    for (const [userId, n] of counts) {
      await notifyUsers(db, [userId], {
        kind: "REQUEST_TREATED",
        title: `${n} terminal mapping${n === 1 ? " has" : "s have"} been treated by ${vendorName}`,
        link: "/requests?status=TREATED",
      });
    }
  }
  return res;
}

export async function bulkClose(actor: Actor, ids: string[]) {
  return bulk(ids, (id) => closeRequest(actor, id));
}

/* ───────────────────────────── search / list ───────────────────────────── */

export const searchSchema = z.object({
  q: z.string().max(100).optional(),
  accountNumber: z.string().max(20).optional(),
  status: z.array(z.enum(REQUEST_STATUSES)).max(10).optional(),
  type: z.enum(REQUEST_TYPES).optional(),
  state: z.string().max(40).optional(),
  anmId: z.string().uuid().optional(),
  vendorId: z.string().uuid().optional(),
  createdBy: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  priority: z.enum(PRIORITIES).optional(),
  dateField: z.enum(["createdAt", "submittedAt", "treatedAt"]).default("createdAt"),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  mine: z.boolean().optional(),
  sort: z
    .enum(["createdAt", "submittedAt", "treatedAt", "reference", "serialNumber", "tid", "agentName", "state", "anmName", "status", "priority"])
    .default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  page: z.number().int().min(1).max(100000).default(1),
  pageSize: z.number().int().min(1).max(200).default(25),
});
export type SearchInput = z.input<typeof searchSchema>;

const creator = alias(users, "creator");
const treater = alias(users, "treater");
const submitter = alias(users, "submitter");

export function buildRequestFilters(actor: Actor, f: z.infer<typeof searchSchema>): SQL[] {
  const conds: SQL[] = [];
  // Scope by role (server-side, never trust the client).
  if (actor.role === "VENDOR_USER") {
    if (!actor.vendorId) throw forbidden();
    conds.push(eq(requests.vendorId, actor.vendorId));
    conds.push(inArray(requests.status, VENDOR_VISIBLE_STATUSES));
  } else if (!can(actor.role, "request:view_all")) {
    conds.push(eq(requests.createdBy, actor.id));
  }
  if (f.mine) conds.push(eq(requests.createdBy, actor.id));
  if (f.q && f.q.trim()) {
    const term = f.q.trim();
    const like = `%${term.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    const idLike = `%${normalizeIdentifier(term).replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    conds.push(
      or(
        ilike(requests.reference, like),
        ilike(requests.serialNumber, idLike),
        ilike(requests.tid, idLike),
        ilike(requests.iswTid, idLike),
        ilike(requests.agentName, like),
        ilike(requests.anmName, like),
      )!,
    );
  }
  if (f.accountNumber && f.accountNumber.trim()) {
    const acct = normalizeAccount(f.accountNumber);
    if (/^\d{10}$/.test(acct)) conds.push(eq(requests.accountHash, hmac(acct)));
    else if (/^\d{4}$/.test(acct)) conds.push(eq(requests.accountLast4, acct));
    else conds.push(sql`false`);
  }
  if (f.status?.length) {
    const allowed = actor.role === "VENDOR_USER" ? f.status.filter((s) => VENDOR_VISIBLE_STATUSES.includes(s)) : f.status;
    conds.push(allowed.length ? inArray(requests.status, allowed) : sql`false`);
  }
  if (f.type) conds.push(eq(requests.type, f.type));
  if (f.state) conds.push(eq(requests.state, f.state));
  if (f.anmId) conds.push(eq(requests.anmId, f.anmId));
  if (f.vendorId && actor.role !== "VENDOR_USER") conds.push(eq(requests.vendorId, f.vendorId));
  if (f.createdBy && actor.role !== "VENDOR_USER") conds.push(eq(requests.createdBy, f.createdBy));
  if (f.batchId) conds.push(eq(requests.batchId, f.batchId));
  if (f.priority) conds.push(eq(requests.priority, f.priority));
  const dateCol = f.dateField === "submittedAt" ? requests.submittedAt : f.dateField === "treatedAt" ? requests.treatedAt : requests.createdAt;
  if (f.dateFrom) conds.push(gte(dateCol, new Date(`${f.dateFrom}T00:00:00+01:00`)));
  if (f.dateTo) conds.push(lte(dateCol, new Date(`${f.dateTo}T23:59:59.999+01:00`)));
  return conds;
}

export async function searchRequests(actor: Actor, input: unknown) {
  const parsed = searchSchema.safeParse(input ?? {});
  if (!parsed.success) throw vErr(parsed.error);
  const f = parsed.data;
  const db = getDb();
  const conds = buildRequestFilters(actor, f);
  const where = conds.length ? and(...conds) : undefined;
  const sortCol = {
    createdAt: requests.createdAt,
    submittedAt: requests.submittedAt,
    treatedAt: requests.treatedAt,
    reference: requests.reference,
    serialNumber: requests.serialNumber,
    tid: requests.tid,
    agentName: requests.agentName,
    state: requests.state,
    anmName: requests.anmName,
    status: requests.status,
    priority: requests.priority,
  }[f.sort];
  const order = f.dir === "asc" ? sql`${sortCol} asc nulls last` : sql`${sortCol} desc nulls last`;

  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(requests).where(where);
  const rows = await db
    .select({
      id: requests.id,
      reference: requests.reference,
      type: requests.type,
      status: requests.status,
      priority: requests.priority,
      serialNumber: requests.serialNumber,
      tid: requests.tid,
      iswTid: requests.iswTid,
      agentName: requests.agentName,
      accountLast4: requests.accountLast4,
      state: requests.state,
      area: requests.area,
      anmName: requests.anmName,
      createdAt: requests.createdAt,
      submittedAt: requests.submittedAt,
      treatedAt: requests.treatedAt,
      exceptionReason: requests.exceptionReason,
      createdByName: creator.fullName,
      treatedByName: treater.fullName,
      vendorAssigneeId: requests.vendorAssigneeId,
    })
    .from(requests)
    .leftJoin(creator, eq(creator.id, requests.createdBy))
    .leftJoin(treater, eq(treater.id, requests.treatedBy))
    .where(where)
    .orderBy(order, desc(requests.id))
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);

  const vendor = actor.role === "VENDOR_USER";
  return {
    total,
    page: f.page,
    pageSize: f.pageSize,
    rows: rows.map((r) => ({
      ...r,
      account: maskAccount(r.accountLast4),
      accountLast4: undefined,
      // Vendors never see internal user names.
      createdByName: vendor ? "Wakeel Operations" : r.createdByName,
      assignedToMe: vendor ? r.vendorAssigneeId === actor.id : undefined,
      vendorAssigneeId: undefined,
    })),
  };
}

/* ───────────────────────────── detail ───────────────────────────── */

export async function getRequestDetail(actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) throw notFound("Request");
  const db = getDb();
  const [row] = await db
    .select({
      r: requests,
      createdByName: creator.fullName,
      treatedByName: treater.fullName,
      submittedByName: submitter.fullName,
      vendorName: vendors.name,
    })
    .from(requests)
    .leftJoin(creator, eq(creator.id, requests.createdBy))
    .leftJoin(treater, eq(treater.id, requests.treatedBy))
    .leftJoin(submitter, eq(submitter.id, requests.submittedBy))
    .leftJoin(vendors, eq(vendors.id, requests.vendorId))
    .where(eq(requests.id, id));
  if (!row || !canView(actor, row.r)) throw notFound("Request");
  const r = row.r;
  const vendor = actor.role === "VENDOR_USER";

  const events = await db
    .select()
    .from(workflowEvents)
    .where(vendor ? and(eq(workflowEvents.requestId, id), eq(workflowEvents.vendorVisible, true)) : eq(workflowEvents.requestId, id))
    .orderBy(asc(workflowEvents.createdAt), asc(workflowEvents.id));

  let previous: null | { version: number; agentName: string; account: string; state: string; area: string | null; anmName: string; effectiveFrom: Date } = null;
  if (r.previousMappingId) {
    const [p] = await db.select().from(terminalMappings).where(eq(terminalMappings.id, r.previousMappingId));
    if (p) previous = { version: p.version, agentName: p.agentName, account: maskAccount(p.accountLast4), state: p.state, area: p.area, anmName: p.anmName, effectiveFrom: p.effectiveFrom };
  }

  const actionable = vendor && VENDOR_ACTIONABLE_STATUSES.includes(r.status);
  const internal = isInternal(actor.role);
  // Vendor gets the full account only while it needs it for TMS entry.
  const accountFull = actionable ? decrypt(r.accountEnc) : null;

  const allowed = (action: WorkflowAction) => {
    try {
      assertAction(actor, action, r);
      return true;
    } catch {
      return false;
    }
  };

  return {
    id: r.id,
    reference: r.reference,
    type: r.type,
    status: r.status,
    priority: r.priority,
    rowVersion: r.rowVersion,
    terminalId: internal ? r.terminalId : undefined,
    serialNumber: r.serialNumber,
    tid: r.tid,
    iswTid: r.iswTid,
    agentName: r.agentName,
    account: maskAccount(r.accountLast4),
    accountFull,
    state: r.state,
    area: r.area,
    anmId: internal ? r.anmId : undefined,
    anmName: r.anmName,
    reason: internal ? r.reason : null,
    internalComment: internal ? r.internalComment : null,
    vendorName: row.vendorName,
    createdAt: r.createdAt,
    createdByName: vendor ? "Wakeel Operations" : row.createdByName,
    submittedAt: r.submittedAt,
    submittedByName: vendor ? "Wakeel Operations" : row.submittedByName,
    vendorOpenedAt: r.vendorOpenedAt,
    startedAt: r.startedAt,
    treatedAt: r.treatedAt,
    treatedByName: row.treatedByName,
    treatmentComment: r.treatmentComment,
    exceptionReason: r.exceptionReason,
    exceptionComment: r.exceptionComment,
    exceptionAt: r.exceptionAt,
    exceptionCount: r.exceptionCount,
    returnComment: internal ? r.returnComment : null,
    cancelReason: r.cancelReason,
    cancelledAt: r.cancelledAt,
    closedAt: r.closedAt,
    previous,
    assignedToMe: vendor ? r.vendorAssigneeId === actor.id : undefined,
    events: events.map((e) => ({
      id: e.id,
      action: e.action,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      actorName: vendor && e.actorRole !== "VENDOR_USER" ? "Wakeel Operations" : e.actorName,
      actorRole: e.actorRole,
      comment: e.comment,
      details: internal ? e.details : e.action === "AMENDED" ? e.details : null,
      createdAt: e.createdAt,
    })),
    permissions: {
      edit: allowed("UPDATE"),
      markReady: allowed("MARK_READY"),
      submit: allowed("SUBMIT_TO_VENDOR"),
      resubmit: allowed("RESUBMIT"),
      amend: allowed("AMEND") && r.status !== "IN_PROGRESS",
      start: allowed("START"),
      release: allowed("RELEASE"),
      treat: allowed("TREAT"),
      exception: allowed("RAISE_EXCEPTION"),
      return: allowed("RETURN"),
      cancel:
        actor.role === "FIELD_SUBMITTER"
          ? r.createdBy === actor.id && ["DRAFT", "READY_FOR_REVIEW", "RETURNED"].includes(r.status)
          : allowed("CANCEL"),
      close: allowed("CLOSE"),
      revealAccount: can(actor.role, "account:view_full") || (actor.role === "FIELD_SUBMITTER" && r.createdBy === actor.id),
    },
  };
}
export type RequestDetail = Awaited<ReturnType<typeof getRequestDetail>>;

/** Editable values for the edit form (full account for authorised editor). */
export async function getRequestForEdit(actor: Actor, id: string) {
  const db = getDb();
  const [r] = await db.select().from(requests).where(eq(requests.id, id));
  if (!r || !canView(actor, r)) throw notFound("Request");
  const canEdit = (() => {
    try {
      assertAction(actor, EDITABLE_STATUSES.includes(r.status) ? "UPDATE" : "AMEND", r);
      return true;
    } catch {
      return false;
    }
  })();
  if (!canEdit) throw forbidden("This request cannot be edited in its current state.");
  await writeAudit(db, actor, { action: "ACCOUNT_REVEALED", entityType: "request", entityId: id, entityLabel: r.reference, newValue: { purpose: "edit" } });
  return {
    id: r.id,
    reference: r.reference,
    type: r.type,
    status: r.status,
    mode: EDITABLE_STATUSES.includes(r.status) ? ("edit" as const) : ("amend" as const),
    rowVersion: r.rowVersion,
    serialNumber: r.serialNumber,
    tid: r.tid,
    iswTid: r.iswTid,
    agentName: r.agentName,
    accountNumber: decrypt(r.accountEnc),
    state: r.state,
    area: r.area,
    anmId: r.anmId,
    priority: r.priority,
    internalComment: r.internalComment,
  };
}
