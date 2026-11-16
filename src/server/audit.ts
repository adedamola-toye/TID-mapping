import "server-only";
import { sql, desc } from "drizzle-orm";
import { auditLogs } from "./db/schema";
import type { DbOrTx } from "./db/client";
import { sha256 } from "./crypto";

export interface AuditActor {
  id: string | null;
  email: string;
  role: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | null;
  entityLabel?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

const SENSITIVE_KEY = /(password|secret|token|hash|enc)$/i;

/** Remove secrets / ciphertext and mask account numbers before anything reaches the audit trail. */
export function sanitizeForAudit(v: unknown, depth = 0): unknown {
  if (v === null || v === undefined || depth > 6) return v ?? null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map((x) => sanitizeForAudit(x, depth + 1));
  if (typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(k)) continue;
      if (/^account(number)?$/i.test(k) && typeof val === "string") {
        out[k] = val.length >= 4 ? `******${val.slice(-4)}` : "******";
        continue;
      }
      out[k] = sanitizeForAudit(val, depth + 1);
    }
    return out;
  }
  if (typeof v === "string" && v.length > 2000) return v.slice(0, 2000) + "…";
  return v;
}

function canonical(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object") {
    const keys = Object.keys(v as object).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

export function computeAuditHash(prevHash: string | null, row: {
  actorId: string | null; actorEmail: string | null; actorRole: string | null; action: string;
  entityType: string | null; entityId: string | null; oldValue: unknown; newValue: unknown;
  ip: string | null; createdAt: Date;
}): string {
  return sha256(
    canonical({
      prev: prevHash,
      actorId: row.actorId,
      actorEmail: row.actorEmail,
      actorRole: row.actorRole,
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      oldValue: row.oldValue ?? null,
      newValue: row.newValue ?? null,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
    }),
  );
}

/**
 * Append an audit record. Call INSIDE the business transaction so the audit entry commits
 * atomically with the change. An advisory lock serialises the hash chain.
 */
export async function writeAudit(db: DbOrTx, actor: AuditActor, entry: AuditEntry): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(727274)`);
  const [last] = await db.select({ hash: auditLogs.hash }).from(auditLogs).orderBy(desc(auditLogs.id)).limit(1);
  const createdAt = new Date();
  const row = {
    actorId: actor.id,
    actorEmail: actor.email,
    actorRole: actor.role,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    entityLabel: entry.entityLabel ?? null,
    oldValue: entry.oldValue === undefined ? null : sanitizeForAudit(entry.oldValue),
    newValue: entry.newValue === undefined ? null : sanitizeForAudit(entry.newValue),
    ip: actor.ip ?? null,
    userAgent: actor.userAgent ? actor.userAgent.slice(0, 300) : null,
    createdAt,
  };
  const prevHash = last?.hash ?? null;
  const hash = computeAuditHash(prevHash, row);
  await db.insert(auditLogs).values({ ...row, prevHash, hash });
}

/** Verify the hash chain end-to-end. Returns the first broken record id, or null if intact. */
export async function verifyAuditChain(db: DbOrTx): Promise<{ ok: boolean; checked: number; brokenAt: number | null }> {
  const rows = await db.select().from(auditLogs).orderBy(auditLogs.id);
  let prev: string | null = null;
  for (const r of rows) {
    const expected = computeAuditHash(prev, {
      actorId: r.actorId, actorEmail: r.actorEmail, actorRole: r.actorRole, action: r.action,
      entityType: r.entityType, entityId: r.entityId, oldValue: r.oldValue, newValue: r.newValue,
      ip: r.ip, createdAt: r.createdAt,
    });
    if (r.prevHash !== prev || r.hash !== expected) return { ok: false, checked: rows.length, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length, brokenAt: null };
}
