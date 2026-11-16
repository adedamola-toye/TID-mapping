import "server-only";
import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, type Tx } from "../db/client";
import { anms, importBatches, importRows, requests, terminalMappings, terminals, users } from "../db/schema";
import { writeAudit } from "../audit";
import { decrypt, encrypt, hmac } from "../crypto";
import { AppError, forbidden, notFound } from "../errors";
import type { Actor } from "../actor";
import { can } from "../rbac";
import { config } from "../config";
import { parseUpload, buildWorkbook } from "../excel";
import { createMappingRequest, createRemappingRequest } from "./requests";
import {
  IMPORT_KINDS,
  OPEN_STATUSES,
  PRIORITIES,
  normalizeState,
  type ImportKind,
  type Priority,
} from "@/lib/constants";
import {
  accountNumberProblem,
  isValidSerial,
  isValidTid,
  normalizeAccount,
  normalizeIdentifier,
  normalizeName,
  nubanCheckDigitValid,
  agentNameSchema,
} from "@/lib/validation";
import { maskAccount } from "@/lib/format";

/* ───────────────────────────── field definitions ───────────────────────────── */

export interface TargetField {
  key: string;
  label: string;
  required: boolean | "oneOf";
  synonyms: readonly string[];
}

const F = {
  serialNumber: { key: "serialNumber", label: "Terminal Serial Number", synonyms: ["terminal serial number", "serial number", "serial no", "serial", "terminal serial", "sn", "s/n", "terminal sn", "serial #"] },
  tid: { key: "tid", label: "TID (Current TID)", synonyms: ["current tid", "tid", "terminal id", "terminal tid", "new tid"] },
  iswTid: { key: "iswTid", label: "ISW TID", synonyms: ["isw tid", "interswitch tid", "isw", "iswtid"] },
  location: { key: "location", label: "Location / State", synonyms: ["location", "state", "region", "state/location"] },
  area: { key: "area", label: "Area / LGA", synonyms: ["area", "lga", "address", "city", "town"] },
  agentName: { key: "agentName", label: "Agent/Merchant Name", synonyms: ["agent/merchant name", "agent merchant name", "agent name", "merchant name", "agent", "merchant", "business name", "new agent name", "new agent"] },
  accountNumber: { key: "accountNumber", label: "Account Number", synonyms: ["account number", "account no", "acct no", "account", "nuban", "account num", "new account number", "new account"] },
  anm: { key: "anm", label: "ANM (code or name)", synonyms: ["anm", "anm name", "anm code", "agent network manager", "new anm"] },
  priority: { key: "priority", label: "Priority", synonyms: ["priority"] },
  status: { key: "status", label: "Status", synonyms: ["status"] },
  comment: { key: "comment", label: "Comment", synonyms: ["comment", "comments", "remark", "remarks", "status/comment", "status comment", "note", "notes"] },
  reason: { key: "reason", label: "Remapping Reason", synonyms: ["reason", "remap reason", "remapping reason"] },
} as const;

export const IMPORT_FIELDS: Record<ImportKind, TargetField[]> = {
  TERMINAL_STOCK: [
    { ...F.serialNumber, required: true },
    { ...F.tid, required: false },
    { ...F.iswTid, required: false },
    { ...F.location, required: false },
    { ...F.status, required: false },
    { ...F.comment, required: false },
  ],
  MAPPING: [
    { ...F.serialNumber, required: true },
    { ...F.tid, required: true },
    { ...F.iswTid, required: false },
    { ...F.agentName, required: true },
    { ...F.accountNumber, required: true },
    { ...F.location, required: true },
    { ...F.area, required: false },
    { ...F.anm, required: true },
    { ...F.priority, required: false },
    { ...F.comment, required: false },
  ],
  REMAPPING: [
    { ...F.serialNumber, required: "oneOf" },
    { ...F.tid, required: "oneOf" },
    { ...F.agentName, required: true },
    { ...F.accountNumber, required: true },
    { ...F.location, required: true },
    { ...F.area, required: false },
    { ...F.anm, required: true },
    { ...F.reason, required: true },
    { ...F.priority, required: false },
    { ...F.comment, required: false },
  ],
};

const normHeader = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

function isKnownHeader(h: string) {
  const n = normHeader(h);
  return Object.values(F).some((f) => f.synonyms.some((s) => normHeader(s) === n));
}

export function autoMapColumns(kind: ImportKind, headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {};
  const used = new Set<string>();
  for (const field of IMPORT_FIELDS[kind]) {
    let match: string | null = null;
    for (const syn of field.synonyms) {
      const h = headers.find((x) => !used.has(x) && normHeader(x) === normHeader(syn));
      if (h) {
        match = h;
        break;
      }
    }
    mapping[field.key] = match;
    if (match) used.add(match);
  }
  return mapping;
}

function requireImport(actor: Actor) {
  if (!can(actor.role, "import:run")) throw forbidden("You are not authorised to import batches.");
}

/* ───────────────────────────── upload ───────────────────────────── */

export async function uploadBatch(actor: Actor, kindIn: string, fileName: string, buf: Buffer) {
  requireImport(actor);
  const kind = z.enum(IMPORT_KINDS).safeParse(kindIn);
  if (!kind.success) throw new AppError("VALIDATION", "Select what this file contains.");
  const cfg = config();
  if (buf.length > cfg.IMPORT_MAX_BYTES) throw new AppError("BAD_REQUEST", `File is too large (max ${(cfg.IMPORT_MAX_BYTES / 1048576).toFixed(0)} MB).`);
  if (!/^[\w\-. ()]{1,200}\.(xlsx|csv)$/i.test(fileName)) {
    throw new AppError("BAD_REQUEST", "Upload an .xlsx or .csv file with a simple file name.");
  }
  const parsed = await parseUpload(fileName, buf, { maxRows: cfg.IMPORT_MAX_ROWS, isKnownHeader });
  const mapping = autoMapColumns(kind.data, parsed.headers);
  const db = getDb();
  const batch = await db.transaction(async (tx) => {
    const res = await tx.execute(sql`select nextval('import_ref_seq')::bigint as n`);
    const ref = `WKL-BAT-${String((res.rows[0] as { n: string }).n).padStart(5, "0")}`;
    const [b] = await tx
      .insert(importBatches)
      .values({
        reference: ref,
        kind: kind.data,
        fileName: fileName.slice(0, 255),
        sheetName: parsed.sheetName,
        headers: parsed.headers,
        columnMapping: mapping,
        totalRows: parsed.rows.length,
        uploadedBy: actor.id,
      })
      .returning();
    for (let i = 0; i < parsed.rows.length; i += 500) {
      await tx.insert(importRows).values(
        parsed.rows.slice(i, i + 500).map((r) => ({ batchId: b.id, rowNumber: r.rowNumber, rawEnc: encrypt(JSON.stringify(r.values)) })),
      );
    }
    await writeAudit(tx, actor, {
      action: "IMPORT_UPLOADED",
      entityType: "import_batch",
      entityId: b.id,
      entityLabel: ref,
      newValue: { kind: kind.data, fileName, rows: parsed.rows.length, headers: parsed.headers },
    });
    return b;
  });
  return { batchId: batch.id, reference: batch.reference, headers: parsed.headers, mapping, totalRows: parsed.rows.length };
}

/* ───────────────────────────── validation ───────────────────────────── */

type RowStatus = "VALID" | "ERROR" | "DUPLICATE";
interface RowEval {
  status: RowStatus;
  errors: Record<string, string>;
  warnings: string[];
  normalized: Record<string, unknown>;
}

interface Ctx {
  kind: ImportKind;
  anmByKey: Map<string, { id: string; fullName: string; isActive: boolean }>;
  terminalBySerial: Map<string, typeof terminals.$inferSelect>;
  terminalByTid: Map<string, typeof terminals.$inferSelect>;
  openByTerminal: Map<string, string>;
  currentMapping: Map<string, typeof terminalMappings.$inferSelect>;
  seenSerial: Map<string, number>;
  seenTid: Map<string, number>;
  seenIsw: Map<string, number>;
}

function pick(values: Record<string, string>, mapping: Record<string, string | null>, key: string): string {
  const col = mapping[key];
  return col ? (values[col] ?? "").trim() : "";
}

function evaluateRow(ctx: Ctx, rowNumber: number, values: Record<string, string>, mapping: Record<string, string | null>): RowEval {
  const cfg = config();
  const errors: Record<string, string> = {};
  const warnings: string[] = [];
  const n: Record<string, unknown> = {};
  let duplicate = false;

  const serial = normalizeIdentifier(pick(values, mapping, "serialNumber"));
  const tid = normalizeIdentifier(pick(values, mapping, "tid"));
  const isw = normalizeIdentifier(pick(values, mapping, "iswTid"));
  n.serialNumber = serial || null;
  n.tid = tid || null;
  n.iswTid = isw || null;

  if (ctx.kind !== "REMAPPING" || serial) {
    if (!serial) {
      if (ctx.kind !== "REMAPPING") errors.serialNumber = "Serial number is required.";
    } else if (!isValidSerial(serial)) errors.serialNumber = "Invalid serial number format.";
  }
  if (tid && !isValidTid(tid, cfg.TID_PATTERN)) errors.tid = "Invalid TID format (expected 8 letters/digits).";
  if (ctx.kind === "MAPPING" && !tid) errors.tid = "TID is required.";
  if (ctx.kind === "REMAPPING" && !serial && !tid) errors.serialNumber = "Provide the serial number or TID of the terminal.";
  if (isw && !isValidTid(isw, cfg.TID_PATTERN)) errors.iswTid = "Invalid ISW TID format.";

  // In-file duplicates.
  if (serial) {
    const first = ctx.seenSerial.get(serial);
    if (first !== undefined) {
      duplicate = true;
      errors.serialNumber = `Duplicate of row ${first} in this file.`;
    } else ctx.seenSerial.set(serial, rowNumber);
  }
  if (tid) {
    const first = ctx.seenTid.get(tid);
    if (first !== undefined) {
      duplicate = true;
      errors.tid = `TID duplicated (row ${first}) in this file.`;
    } else ctx.seenTid.set(tid, rowNumber);
  }
  if (isw && ctx.kind === "TERMINAL_STOCK") {
    const first = ctx.seenIsw.get(isw);
    if (first !== undefined) warnings.push(`ISW TID also appears on row ${first}.`);
    else ctx.seenIsw.set(isw, rowNumber);
  }

  if (ctx.kind === "TERMINAL_STOCK") {
    const loc = pick(values, mapping, "location");
    n.location = loc || null;
    if (loc && !normalizeState(loc)) warnings.push(`Location "${loc}" is not a recognised state; kept as text.`);
    let status = pick(values, mapping, "status");
    let comment = pick(values, mapping, "comment");
    // Legacy sheets mix status and remarks in one "Status/Comment" column: split known status words out.
    if (!status && /^(done|pending|treated|completed|mapped|not done|in progress)$/i.test(comment)) {
      status = comment;
      comment = "";
    }
    n.status = status || null;
    n.comment = comment || null;
    if (serial && !errors.serialNumber) {
      const existing = ctx.terminalBySerial.get(serial);
      if (existing) {
        if (tid && existing.tid && existing.tid !== tid) errors.tid = `Serial already registered with TID ${existing.tid}.`;
        else {
          duplicate = true;
          errors.serialNumber = "Terminal already exists in the system.";
        }
      }
      if (tid && !errors.tid) {
        const owner = ctx.terminalByTid.get(tid);
        if (owner && owner.serialNumber !== serial) errors.tid = `TID already assigned to terminal ${owner.serialNumber}.`;
      }
    }
  } else {
    // Merchant / agent details.
    const nameRaw = pick(values, mapping, "agentName");
    const nameParsed = agentNameSchema.safeParse(nameRaw);
    if (!nameParsed.success) errors.agentName = nameParsed.error.issues[0].message;
    else n.agentName = nameParsed.data;

    const acct = normalizeAccount(pick(values, mapping, "accountNumber"));
    const ap = accountNumberProblem(acct);
    if (ap) errors.accountNumber = ap;
    else if (cfg.NUBAN_BANK_CODE && !nubanCheckDigitValid(acct, cfg.NUBAN_BANK_CODE)) errors.accountNumber = "NUBAN check digit is invalid.";
    else {
      n.accountEnc = encrypt(acct);
      n.accountHash = hmac(acct);
      n.account = maskAccount(acct.slice(-4));
    }

    const locRaw = pick(values, mapping, "location");
    const st = normalizeState(locRaw);
    if (!locRaw) errors.location = "Location/state is required.";
    else if (!st) errors.location = `"${locRaw}" is not a recognised Nigerian state.`;
    else n.state = st;
    const area = pick(values, mapping, "area");
    n.area = area ? area.replace(/\s+/g, " ").slice(0, 120) : null;

    const anmRaw = pick(values, mapping, "anm");
    if (!anmRaw) errors.anm = "ANM is required.";
    else {
      const a = ctx.anmByKey.get(anmRaw.toUpperCase()) ?? ctx.anmByKey.get(normalizeName(anmRaw));
      if (!a) errors.anm = `"${anmRaw}" is not on the approved ANM list.`;
      else if (!a.isActive) errors.anm = `ANM "${a.fullName}" is inactive.`;
      else {
        n.anmId = a.id;
        n.anmName = a.fullName;
      }
    }

    const prRaw = pick(values, mapping, "priority").toUpperCase();
    if (prRaw && !(PRIORITIES as readonly string[]).includes(prRaw)) errors.priority = "Priority must be LOW, NORMAL, HIGH or URGENT.";
    n.priority = (prRaw || "NORMAL") as Priority;
    const comment = pick(values, mapping, "comment");
    n.comment = comment ? comment.slice(0, 1000) : null;

    if (ctx.kind === "MAPPING" && serial && !errors.serialNumber) {
      const t = ctx.terminalBySerial.get(serial);
      if (tid && !errors.tid) {
        const owner = ctx.terminalByTid.get(tid);
        if (owner && owner.serialNumber !== serial) errors.tid = `TID already assigned to terminal ${owner.serialNumber}.`;
      }
      if (t) {
        if (t.tid && tid && t.tid !== tid) errors.tid = `This serial is registered with TID ${t.tid}.`;
        if (ctx.openByTerminal.has(t.id)) {
          duplicate = true;
          errors.serialNumber = `Terminal already has a pending request (${ctx.openByTerminal.get(t.id)}).`;
        } else if (t.currentMappingId) {
          duplicate = true;
          errors.serialNumber = "Terminal already has an active mapping — use a remapping batch.";
        }
        if (t.status === "INACTIVE") errors.serialNumber = "Terminal is inactive.";
      }
    }

    if (ctx.kind === "REMAPPING") {
      const reason = pick(values, mapping, "reason");
      if (reason.length < 3) errors.reason = "A remapping reason is required.";
      n.reason = reason.slice(0, 500);
      const t = (serial && ctx.terminalBySerial.get(serial)) || (tid && ctx.terminalByTid.get(tid)) || null;
      if (!t) {
        if (!errors.serialNumber && !errors.tid) errors.serialNumber = "Terminal not found.";
      } else {
        n.terminalId = t.id;
        n.serialNumber = t.serialNumber;
        n.tid = t.tid;
        if (serial && t.serialNumber !== serial) errors.serialNumber = "Serial number does not match the terminal's record (serial cannot change on remap).";
        if (tid && t.tid !== tid) errors.tid = `TID does not match the terminal's record (${t.tid}). TID cannot change on remap.`;
        if (ctx.openByTerminal.has(t.id)) {
          duplicate = true;
          errors.serialNumber = `Terminal already has a pending request (${ctx.openByTerminal.get(t.id)}).`;
        } else if (!t.currentMappingId) errors.serialNumber = "Terminal has no active mapping — use a new-mapping batch.";
        else {
          const cur = ctx.currentMapping.get(t.id);
          if (cur && n.agentName === cur.agentName && n.state === cur.state && n.anmId === cur.anmId && n.accountHash && cur.accountEnc) {
            try {
              if (hmac(decrypt(cur.accountEnc)) === n.accountHash && (cur.area ?? null) === (n.area ?? null))
                errors.agentName = "New mapping is identical to the current mapping.";
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  }

  const hasErrors = Object.keys(errors).length > 0;
  return {
    status: hasErrors ? (duplicate ? "DUPLICATE" : "ERROR") : "VALID",
    errors,
    warnings,
    normalized: n,
  };
}

async function loadContext(kind: ImportKind, rows: { values: Record<string, string> }[], mapping: Record<string, string | null>): Promise<Ctx> {
  const db = getDb();
  const serials = new Set<string>();
  const tids = new Set<string>();
  for (const r of rows) {
    const s = normalizeIdentifier(pick(r.values, mapping, "serialNumber"));
    const t = normalizeIdentifier(pick(r.values, mapping, "tid"));
    if (s) serials.add(s);
    if (t) tids.add(t);
  }
  const ts: (typeof terminals.$inferSelect)[] = [];
  const sArr = [...serials];
  const tArr = [...tids];
  for (let i = 0; i < Math.max(sArr.length, tArr.length); i += 1000) {
    const sChunk = sArr.slice(i, i + 1000);
    const tChunk = tArr.slice(i, i + 1000);
    const conds = [];
    if (sChunk.length) conds.push(inArray(terminals.serialNumber, sChunk));
    if (tChunk.length) conds.push(inArray(terminals.tid, tChunk));
    if (conds.length) ts.push(...(await db.select().from(terminals).where(or(...conds))));
  }
  const terminalBySerial = new Map(ts.map((t) => [t.serialNumber, t]));
  const terminalByTid = new Map(ts.filter((t) => t.tid).map((t) => [t.tid as string, t]));
  const ids = [...new Set(ts.map((t) => t.id))];
  const openByTerminal = new Map<string, string>();
  const currentMapping = new Map<string, typeof terminalMappings.$inferSelect>();
  for (let i = 0; i < ids.length; i += 1000) {
    const chunk = ids.slice(i, i + 1000);
    const open = await db
      .select({ terminalId: requests.terminalId, reference: requests.reference })
      .from(requests)
      .where(and(inArray(requests.terminalId, chunk), inArray(requests.status, OPEN_STATUSES)));
    for (const o of open) openByTerminal.set(o.terminalId, o.reference);
    if (kind === "REMAPPING") {
      const cms = await db.select().from(terminalMappings).where(and(inArray(terminalMappings.terminalId, chunk), eq(terminalMappings.isCurrent, true)));
      for (const m of cms) currentMapping.set(m.terminalId, m);
    }
  }
  const anmRows = await db.select({ id: anms.id, code: anms.code, fullName: anms.fullName, isActive: anms.isActive }).from(anms);
  const anmByKey = new Map<string, { id: string; fullName: string; isActive: boolean }>();
  for (const a of anmRows) {
    anmByKey.set(a.code.toUpperCase(), a);
    anmByKey.set(normalizeName(a.fullName), a);
  }
  return { kind, anmByKey, terminalBySerial, terminalByTid, openByTerminal, currentMapping, seenSerial: new Map(), seenTid: new Map(), seenIsw: new Map() };
}

async function getBatchForActor(actor: Actor, batchId: string) {
  requireImport(actor);
  if (!z.string().uuid().safeParse(batchId).success) throw notFound("Batch");
  const [b] = await getDb().select().from(importBatches).where(eq(importBatches.id, batchId));
  if (!b) throw notFound("Batch");
  return b;
}

/** Apply a column mapping and validate every row. Nothing is imported at this stage. */
export async function validateBatch(actor: Actor, batchId: string, mappingIn?: Record<string, string | null>) {
  const b = await getBatchForActor(actor, batchId);
  if (b.status === "IMPORTED" || b.status === "CANCELLED") throw new AppError("INVALID_STATE", "This batch has already been processed.");
  const fields = IMPORT_FIELDS[b.kind];
  const mapping: Record<string, string | null> = {};
  const src = mappingIn ?? b.columnMapping ?? {};
  for (const f of fields) {
    const col = src[f.key];
    mapping[f.key] = col && b.headers.includes(col) ? col : null;
  }
  const missing = fields.filter((f) => f.required === true && !mapping[f.key]).map((f) => f.label);
  if (b.kind === "REMAPPING" && !mapping.serialNumber && !mapping.tid) missing.push("Terminal Serial Number or TID");
  if (missing.length) {
    throw new AppError("VALIDATION", `Map the required columns before validating: ${missing.join(", ")}.`);
  }

  const db = getDb();
  const rows = await db.select().from(importRows).where(eq(importRows.batchId, batchId)).orderBy(asc(importRows.rowNumber));
  const decoded = rows.map((r) => ({ id: r.id, rowNumber: r.rowNumber, values: JSON.parse(decrypt(r.rawEnc)) as Record<string, string>, status: r.status }));
  const ctx = await loadContext(b.kind, decoded, mapping);
  const counts = { VALID: 0, ERROR: 0, DUPLICATE: 0 };
  const updates: { id: string; ev: RowEval }[] = [];
  for (const r of decoded) {
    if (r.status === "IMPORTED" || r.status === "SKIPPED") continue;
    const ev = evaluateRow(ctx, r.rowNumber, r.values, mapping);
    counts[ev.status]++;
    updates.push({ id: r.id, ev });
  }
  await db.transaction(async (tx) => {
    // Bulk update via UNNEST for speed.
    for (let i = 0; i < updates.length; i += 1000) {
      const chunk = updates.slice(i, i + 1000);
      await tx.execute(sql`
        update import_rows ir set
          status = v.status::import_row_status,
          errors = v.errors,
          warnings = v.warnings,
          normalized = v.normalized,
          updated_at = now()
        from jsonb_to_recordset(${JSON.stringify(
          chunk.map((u) => ({ id: u.id, status: u.ev.status, errors: u.ev.errors, warnings: u.ev.warnings, normalized: u.ev.normalized })),
        )}::jsonb) as v(id uuid, status text, errors jsonb, warnings jsonb, normalized jsonb)
        where ir.id = v.id
      `);
    }
    await tx
      .update(importBatches)
      .set({ status: "VALIDATED", columnMapping: mapping, validRows: counts.VALID, errorRows: counts.ERROR, duplicateRows: counts.DUPLICATE, updatedAt: new Date() })
      .where(eq(importBatches.id, batchId));
    await writeAudit(tx, actor, { action: "IMPORT_VALIDATED", entityType: "import_batch", entityId: batchId, entityLabel: b.reference, newValue: { mapping, ...counts } });
  });
  return { counts, mapping };
}

/** Correct a single row's raw values in the browser, then re-validate the whole batch. */
export async function correctRow(actor: Actor, batchId: string, rowId: string, values: Record<string, string>) {
  const b = await getBatchForActor(actor, batchId);
  if (b.status !== "VALIDATED" && b.status !== "UPLOADED") throw new AppError("INVALID_STATE", "This batch can no longer be edited.");
  const db = getDb();
  const [row] = await db.select().from(importRows).where(and(eq(importRows.id, rowId), eq(importRows.batchId, batchId)));
  if (!row) throw notFound("Row");
  if (row.status === "IMPORTED") throw new AppError("INVALID_STATE", "This row has already been imported.");
  const current = JSON.parse(decrypt(row.rawEnc)) as Record<string, string>;
  for (const h of b.headers) {
    if (values[h] !== undefined) current[h] = String(values[h]).slice(0, 500);
  }
  await db.update(importRows).set({ rawEnc: encrypt(JSON.stringify(current)), updatedAt: new Date() }).where(eq(importRows.id, rowId));
  await writeAudit(db, actor, { action: "IMPORT_ROW_CORRECTED", entityType: "import_batch", entityId: batchId, entityLabel: `${b.reference} row ${row.rowNumber}` });
  return validateBatch(actor, batchId);
}

export async function skipRow(actor: Actor, batchId: string, rowId: string) {
  const b = await getBatchForActor(actor, batchId);
  if (b.status === "IMPORTED" || b.status === "CANCELLED") throw new AppError("INVALID_STATE", "This batch can no longer be edited.");
  const db = getDb();
  await db.update(importRows).set({ status: "SKIPPED", updatedAt: new Date() }).where(and(eq(importRows.id, rowId), eq(importRows.batchId, batchId)));
  return validateBatch(actor, batchId);
}

/** Batch detail with rows (raw values shown so users can correct them). */
export async function getBatch(actor: Actor, batchId: string, opts: { status?: string; page?: number; pageSize?: number } = {}) {
  const b = await getBatchForActor(actor, batchId);
  const db = getDb();
  const pageSize = Math.min(opts.pageSize ?? 50, 200);
  const page = Math.max(1, opts.page ?? 1);
  const statusFilter = opts.status && ["VALID", "ERROR", "DUPLICATE", "IMPORTED", "SKIPPED", "PENDING"].includes(opts.status) ? opts.status : null;
  const where = statusFilter
    ? and(eq(importRows.batchId, batchId), eq(importRows.status, statusFilter as "VALID"))
    : eq(importRows.batchId, batchId);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(importRows).where(where);
  const rows = await db
    .select()
    .from(importRows)
    .where(where)
    .orderBy(asc(importRows.rowNumber))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const statusCounts = await db
    .select({ status: importRows.status, n: sql<number>`count(*)::int` })
    .from(importRows)
    .where(eq(importRows.batchId, batchId))
    .groupBy(importRows.status);
  const [uploader] = await db.select({ name: users.fullName }).from(users).where(eq(users.id, b.uploadedBy));
  return {
    batch: { ...b, uploadedByName: uploader?.name ?? null },
    fields: IMPORT_FIELDS[b.kind],
    statusCounts: Object.fromEntries(statusCounts.map((s) => [s.status, s.n])),
    total,
    page,
    pageSize,
    rows: rows.map((r) => {
      const raw = JSON.parse(decrypt(r.rawEnc)) as Record<string, string>;
      const norm = { ...(r.normalized ?? {}) } as Record<string, unknown>;
      delete norm.accountEnc;
      delete norm.accountHash;
      return { id: r.id, rowNumber: r.rowNumber, status: r.status, errors: r.errors ?? {}, warnings: r.warnings ?? [], raw, normalized: norm, entityId: r.entityId };
    }),
  };
}

export async function listBatches(actor: Actor) {
  requireImport(actor);
  const db = getDb();
  return db
    .select({
      id: importBatches.id,
      reference: importBatches.reference,
      kind: importBatches.kind,
      status: importBatches.status,
      fileName: importBatches.fileName,
      totalRows: importBatches.totalRows,
      validRows: importBatches.validRows,
      errorRows: importBatches.errorRows,
      duplicateRows: importBatches.duplicateRows,
      importedRows: importBatches.importedRows,
      createdAt: importBatches.createdAt,
      importedAt: importBatches.importedAt,
      uploadedByName: users.fullName,
    })
    .from(importBatches)
    .leftJoin(users, eq(users.id, importBatches.uploadedBy))
    .orderBy(desc(importBatches.createdAt))
    .limit(200);
}

/**
 * Import all VALID rows. Each row runs in a savepoint: a business-rule failure (e.g. a conflict
 * that appeared since validation) marks just that row as ERROR; any unexpected failure rolls the
 * whole import back so the database is never left half-imported.
 */
export async function commitBatch(actor: Actor, batchId: string, opts: { asDraft?: boolean } = {}) {
  const b = await getBatchForActor(actor, batchId);
  if (b.status !== "VALIDATED") throw new AppError("INVALID_STATE", b.status === "IMPORTED" ? "This batch has already been imported." : "Validate the batch before importing.");
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    // Lock the batch row: prevents a double-click / two users importing the same batch twice.
    const [locked] = await tx.select().from(importBatches).where(eq(importBatches.id, batchId)).for("update");
    if (locked.status !== "VALIDATED") throw new AppError("INVALID_STATE", "This batch is already being imported.");
    const rows = await tx
      .select()
      .from(importRows)
      .where(and(eq(importRows.batchId, batchId), eq(importRows.status, "VALID")))
      .orderBy(asc(importRows.rowNumber));
    let imported = 0;
    let failed = 0;
    for (const row of rows) {
      const n = (row.normalized ?? {}) as Record<string, string | null>;
      try {
        const entityId = await tx.transaction(async (sp) => {
          if (b.kind === "TERMINAL_STOCK") return importStockRow(sp as unknown as Tx, actor, b.id, n);
          const account = n.accountEnc ? decrypt(n.accountEnc) : "";
          if (b.kind === "MAPPING") {
            const r = await createMappingRequest(
              actor,
              { serialNumber: n.serialNumber, tid: n.tid, iswTid: n.iswTid, agentName: n.agentName, accountNumber: account, state: n.state, area: n.area, anmId: n.anmId, priority: n.priority ?? "NORMAL", internalComment: n.comment },
              { asDraft: opts.asDraft, batchId: b.id },
              sp as unknown as Tx,
            );
            return r.id;
          }
          const r = await createRemappingRequest(
            actor,
            { terminalId: n.terminalId, agentName: n.agentName, accountNumber: account, state: n.state, area: n.area, anmId: n.anmId, priority: n.priority ?? "NORMAL", reason: n.reason, internalComment: n.comment },
            { asDraft: opts.asDraft, batchId: b.id },
            sp as unknown as Tx,
          );
          return r.id;
        });
        await tx.update(importRows).set({ status: "IMPORTED", entityId, updatedAt: new Date() }).where(eq(importRows.id, row.id));
        imported++;
      } catch (e) {
        if (!(e instanceof AppError)) throw e; // unexpected → roll back entire import
        failed++;
        await tx
          .update(importRows)
          .set({ status: "ERROR", errors: { _: e.message, ...(e.fieldErrors ?? {}) }, updatedAt: new Date() })
          .where(eq(importRows.id, row.id));
      }
    }
    const [{ errs }] = await tx
      .select({ errs: sql<number>`count(*) filter (where status in ('ERROR'))::int` })
      .from(importRows)
      .where(eq(importRows.batchId, batchId));
    await tx
      .update(importBatches)
      .set({ status: "IMPORTED", importedRows: imported, errorRows: errs, validRows: 0, importedBy: actor.id, importedAt: new Date(), updatedAt: new Date() })
      .where(eq(importBatches.id, batchId));
    await writeAudit(tx, actor, { action: "IMPORT_COMMITTED", entityType: "import_batch", entityId: batchId, entityLabel: b.reference, newValue: { kind: b.kind, imported, failedAtCommit: failed } });
    return { imported, failed };
  });
  return result;
}

async function importStockRow(tx: Tx, actor: Actor, batchId: string, n: Record<string, string | null>): Promise<string> {
  const serial = n.serialNumber as string;
  const [existing] = await tx.select().from(terminals).where(eq(terminals.serialNumber, serial)).for("update");
  if (existing) throw new AppError("CONFLICT", "Terminal already exists in the system.");
  if (n.tid) {
    const [owner] = await tx.select({ s: terminals.serialNumber }).from(terminals).where(eq(terminals.tid, n.tid));
    if (owner) throw new AppError("CONFLICT", `TID already assigned to terminal ${owner.s}.`);
  }
  const vendorRow = await tx.execute(sql`select id from vendors where code = ${process.env.DEFAULT_VENDOR_CODE ?? "ELNEXU"} and is_active limit 1`);
  const vendorId = (vendorRow.rows[0] as { id: string } | undefined)?.id ?? null;
  const [t] = await tx
    .insert(terminals)
    .values({
      serialNumber: serial,
      tid: n.tid,
      iswTid: n.iswTid,
      stockLocation: n.location ? String(n.location).slice(0, 120) : null,
      legacyStatus: n.status ? String(n.status).slice(0, 60) : null,
      legacyComment: n.comment,
      vendorId,
      status: "AVAILABLE",
      importBatchId: batchId,
      createdBy: actor.id,
    })
    .returning();
  await writeAudit(tx, actor, { action: "TERMINAL_CREATED", entityType: "terminal", entityId: t.id, entityLabel: t.serialNumber, newValue: { serialNumber: t.serialNumber, tid: t.tid, iswTid: t.iswTid, batch: batchId } });
  return t.id;
}

export async function cancelBatch(actor: Actor, batchId: string) {
  const b = await getBatchForActor(actor, batchId);
  if (b.status === "IMPORTED") throw new AppError("INVALID_STATE", "An imported batch cannot be cancelled. Cancel the individual requests instead.");
  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.update(importBatches).set({ status: "CANCELLED", updatedAt: new Date() }).where(eq(importBatches.id, batchId));
    await writeAudit(tx, actor, { action: "IMPORT_CANCELLED", entityType: "import_batch", entityId: batchId, entityLabel: b.reference });
  });
}

/** Failed rows (with an "Errors" column) for offline correction and re-upload. */
export async function exportFailedRows(actor: Actor, batchId: string): Promise<{ fileName: string; buffer: Buffer }> {
  const b = await getBatchForActor(actor, batchId);
  const db = getDb();
  const rows = await db
    .select()
    .from(importRows)
    .where(and(eq(importRows.batchId, batchId), inArray(importRows.status, ["ERROR", "DUPLICATE"])))
    .orderBy(asc(importRows.rowNumber));
  const columns = [
    ...b.headers.map((h, i) => ({ header: h, key: `c${i}`, width: 22 })),
    { header: "Errors", key: "errors", width: 60 },
    { header: "Original Row", key: "rowNumber", width: 12 },
  ];
  const data = rows.map((r) => {
    const raw = JSON.parse(decrypt(r.rawEnc)) as Record<string, string>;
    const o: Record<string, unknown> = { rowNumber: r.rowNumber, errors: Object.values(r.errors ?? {}).join("; ") };
    b.headers.forEach((h, i) => (o[`c${i}`] = raw[h] ?? ""));
    return o;
  });
  await writeAudit(db, actor, { action: "IMPORT_FAILED_ROWS_EXPORTED", entityType: "import_batch", entityId: batchId, entityLabel: b.reference, newValue: { rows: rows.length } });
  const buffer = await buildWorkbook([{ name: "Rows to correct", columns, rows: data }]);
  return { fileName: `${b.reference}-rows-to-correct.xlsx`, buffer };
}

function templateHeader(s: string) {
  return s
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace(/\bTid\b/g, "TID")
    .replace(/\bIsw\b/g, "ISW")
    .replace(/\bAnm\b/g, "ANM");
}

/** Downloadable templates for each import kind. */
export async function importTemplate(kind: ImportKind): Promise<Buffer> {
  const fields = IMPORT_FIELDS[kind];
  const example: Record<ImportKind, Record<string, string>> = {
    TERMINAL_STOCK: { serialNumber: "1662426143827", tid: "2ISAHQU1", iswTid: "2ISW0001", location: "Rivers", status: "", comment: "" },
    MAPPING: { serialNumber: "1662426143827", tid: "2ISAHQU1", iswTid: "", agentName: "TEST AGENT ENTERPRISE", accountNumber: "0000000001", location: "Rivers", area: "Obio/Akpor", anm: "ANM-001", priority: "NORMAL", comment: "" },
    REMAPPING: { serialNumber: "1662426143827", tid: "2ISAHQU1", agentName: "NEW TEST AGENT VENTURES", accountNumber: "0000000002", location: "Ogun", area: "Abeokuta South", anm: "ANM-002", reason: "Agent relocated", priority: "NORMAL", comment: "" },
  };
  return buildWorkbook(
    [{ name: "Template", columns: fields.map((f) => ({ header: templateHeader(f.synonyms[0]), key: f.key, width: 24 })), rows: [example[kind]] }],
    { title: `Wakeel import template — ${kind}. Replace the example row (test data) with your records.` },
  );
}
