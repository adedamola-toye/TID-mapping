import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { getDb } from "../db/client";
import { auditLogs, requests, terminalMappings, terminals, users, vendors, workflowEvents } from "../db/schema";
import { forbidden, AppError } from "../errors";
import type { Actor } from "../actor";
import { can } from "../rbac";
import { buildWorkbook } from "../excel";
import { writeAudit } from "../audit";
import { decrypt } from "../crypto";
import { buildRequestFilters, searchSchema } from "./requests";
import { terminalFilters, terminalSearchSchema } from "./terminals";
import { EXCEPTION_REASON_LABELS, OPEN_STATUSES, REQUEST_TYPE_LABELS, STATUS_LABELS, TERMINAL_STATUS_LABELS } from "@/lib/constants";
import { maskAccount } from "@/lib/format";

function requireReports(actor: Actor) {
  if (!can(actor.role, "report:view")) throw forbidden();
}

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

function range(input: unknown) {
  const p = rangeSchema.safeParse(input ?? {});
  const today = new Date();
  const toStr = (d: Date) => d.toISOString().slice(0, 10);
  const to = p.success && p.data.to ? p.data.to : toStr(today);
  const from = p.success && p.data.from ? p.data.from : toStr(new Date(today.getTime() - 29 * 86400_000));
  if (from > to) throw new AppError("VALIDATION", "The start date must be before the end date.");
  return { from, to, fromTs: new Date(`${from}T00:00:00+01:00`), toTs: new Date(`${to}T23:59:59.999+01:00`) };
}

/* ───────────────────────────── dashboard ───────────────────────────── */

export async function dashboard(actor: Actor) {
  if (!can(actor.role, "dashboard:view")) throw forbidden();
  const db = getDb();
  const [t] = await db
    .select({
      total: sql<number>`count(*)::int`,
      mapped: sql<number>`count(*) filter (where ${terminals.status} = 'MAPPED')::int`,
      available: sql<number>`count(*) filter (where ${terminals.status} = 'AVAILABLE')::int`,
      remapped: sql<number>`count(*) filter (where ${terminals.lastRemappedAt} is not null)::int`,
    })
    .from(terminals);
  const [r] = await db
    .select({
      totalMappings: sql<number>`count(*) filter (where ${requests.type} = 'MAPPING')::int`,
      totalRemappings: sql<number>`count(*) filter (where ${requests.type} = 'REMAPPING')::int`,
      pendingMappings: sql<number>`count(*) filter (where ${requests.type} = 'MAPPING' and ${requests.status} in ('DRAFT','READY_FOR_REVIEW','RETURNED'))::int`,
      pendingRemappings: sql<number>`count(*) filter (where ${requests.type} = 'REMAPPING' and ${requests.status} in ('DRAFT','READY_FOR_REVIEW','RETURNED'))::int`,
      readyForReview: sql<number>`count(*) filter (where ${requests.status} = 'READY_FOR_REVIEW')::int`,
      withVendor: sql<number>`count(*) filter (where ${requests.status} in ('SUBMITTED','IN_PROGRESS'))::int`,
      inProgress: sql<number>`count(*) filter (where ${requests.status} = 'IN_PROGRESS')::int`,
      treated: sql<number>`count(*) filter (where ${requests.status} in ('TREATED','CLOSED'))::int`,
      awaitingClose: sql<number>`count(*) filter (where ${requests.status} = 'TREATED')::int`,
      exceptions: sql<number>`count(*) filter (where ${requests.status} = 'EXCEPTION')::int`,
      outstanding: sql<number>`count(*) filter (where ${requests.status} in ('DRAFT','READY_FOR_REVIEW','SUBMITTED','IN_PROGRESS','EXCEPTION','RETURNED'))::int`,
      everSubmitted: sql<number>`count(*) filter (where ${requests.firstSubmittedAt} is not null)::int`,
      everException: sql<number>`count(*) filter (where ${requests.exceptionCount} > 0)::int`,
      avgTreatMs: sql<number>`(extract(epoch from avg(${requests.treatedAt} - ${requests.firstSubmittedAt})) * 1000)::float8`,
      oldestPendingAt: sql<string | null>`min(${requests.submittedAt}) filter (where ${requests.status} in ('SUBMITTED','IN_PROGRESS'))`,
    })
    .from(requests);
  const [today] = await db
    .select({
      created: sql<number>`count(*) filter (where (${requests.createdAt} at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)::int`,
      submitted: sql<number>`count(*) filter (where (${requests.submittedAt} at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)::int`,
      treated: sql<number>`count(*) filter (where (${requests.treatedAt} at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)::int`,
      exceptions: sql<number>`count(*) filter (where (${requests.exceptionAt} at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)::int`,
    })
    .from(requests);
  const treater = alias(users, "treater");
  const recentTreatments = await db
    .select({
      id: requests.id,
      reference: requests.reference,
      type: requests.type,
      serialNumber: requests.serialNumber,
      tid: requests.tid,
      agentName: requests.agentName,
      treatedAt: requests.treatedAt,
      treatedByName: treater.fullName,
    })
    .from(requests)
    .leftJoin(treater, eq(treater.id, requests.treatedBy))
    .where(sql`${requests.treatedAt} is not null`)
    .orderBy(desc(requests.treatedAt))
    .limit(8);
  const byAnm = await db
    .select({ label: terminalMappings.anmName, n: sql<number>`count(*)::int` })
    .from(terminalMappings)
    .where(eq(terminalMappings.isCurrent, true))
    .groupBy(terminalMappings.anmName)
    .orderBy(desc(sql`count(*)`))
    .limit(8);
  const byState = await db
    .select({ label: terminalMappings.state, n: sql<number>`count(*)::int` })
    .from(terminalMappings)
    .where(eq(terminalMappings.isCurrent, true))
    .groupBy(terminalMappings.state)
    .orderBy(desc(sql`count(*)`))
    .limit(8);
  const daily = await db.execute(sql`
    with days as (
      select generate_series((now() at time zone 'Africa/Lagos')::date - 13, (now() at time zone 'Africa/Lagos')::date, interval '1 day')::date as d
    )
    select to_char(d, 'YYYY-MM-DD') as day,
      (select count(*)::int from requests where (submitted_at at time zone 'Africa/Lagos')::date = d) as submitted,
      (select count(*)::int from requests where (treated_at at time zone 'Africa/Lagos')::date = d) as treated
    from days order by d
  `);
  return {
    terminals: t,
    requests: { ...r, exceptionRate: r.everSubmitted ? r.everException / r.everSubmitted : 0 },
    today,
    recentTreatments,
    byAnm,
    byState,
    daily: daily.rows as { day: string; submitted: number; treated: number }[],
  };
}

/** Vendor's own workspace summary. */
export async function vendorSummary(actor: Actor) {
  if (actor.role !== "VENDOR_USER" || !actor.vendorId) throw forbidden();
  const db = getDb();
  const [s] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${requests.status} = 'SUBMITTED')::int`,
      inProgress: sql<number>`count(*) filter (where ${requests.status} = 'IN_PROGRESS')::int`,
      mine: sql<number>`count(*) filter (where ${requests.status} = 'IN_PROGRESS' and ${requests.vendorAssigneeId} = ${actor.id})::int`,
      treatedToday: sql<number>`count(*) filter (where (${requests.treatedAt} at time zone 'Africa/Lagos')::date = (now() at time zone 'Africa/Lagos')::date)::int`,
      exceptions: sql<number>`count(*) filter (where ${requests.status} = 'EXCEPTION')::int`,
      urgent: sql<number>`count(*) filter (where ${requests.status} in ('SUBMITTED','IN_PROGRESS') and ${requests.priority} in ('HIGH','URGENT'))::int`,
    })
    .from(requests)
    .where(eq(requests.vendorId, actor.vendorId));
  return s;
}

/* ───────────────────────────── reports ───────────────────────────── */

export async function dailyReport(actor: Actor, input: unknown) {
  requireReports(actor);
  const { from, to } = range(input);
  const res = await getDb().execute(sql`
    with days as (select generate_series(${from}::date, ${to}::date, interval '1 day')::date as d)
    select to_char(d, 'YYYY-MM-DD') as day,
      (select count(*)::int from requests where (created_at at time zone 'Africa/Lagos')::date = d) as created,
      (select count(*)::int from requests where (submitted_at at time zone 'Africa/Lagos')::date = d) as submitted,
      (select count(*)::int from requests where (treated_at at time zone 'Africa/Lagos')::date = d) as treated,
      (select count(*)::int from requests where (exception_at at time zone 'Africa/Lagos')::date = d) as exceptions,
      (select count(*)::int from requests where (created_at at time zone 'Africa/Lagos')::date <= d
          and (treated_at is null or (treated_at at time zone 'Africa/Lagos')::date > d)
          and (cancelled_at is null or (cancelled_at at time zone 'Africa/Lagos')::date > d)) as outstanding
    from days order by d desc
  `);
  const rows = res.rows as { day: string; created: number; submitted: number; treated: number; exceptions: number; outstanding: number }[];
  const totals = rows.reduce(
    (a, r) => ({ created: a.created + r.created, submitted: a.submitted + r.submitted, treated: a.treated + r.treated, exceptions: a.exceptions + r.exceptions }),
    { created: 0, submitted: 0, treated: 0, exceptions: 0 },
  );
  return { from, to, rows, totals };
}

export async function vendorPerformance(actor: Actor, input: unknown) {
  requireReports(actor);
  const { from, to, fromTs, toTs } = range(input);
  const db = getDb();
  const byVendor = await db
    .select({
      vendor: vendors.name,
      received: sql<number>`count(*) filter (where ${requests.firstSubmittedAt} between ${fromTs} and ${toTs})::int`,
      treated: sql<number>`count(*) filter (where ${requests.treatedAt} between ${fromTs} and ${toTs})::int`,
      exceptions: sql<number>`count(*) filter (where ${requests.exceptionAt} between ${fromTs} and ${toTs})::int`,
      outstanding: sql<number>`count(*) filter (where ${requests.status} in ('SUBMITTED','IN_PROGRESS'))::int`,
      avgTreatMs: sql<number>`(extract(epoch from avg(${requests.treatedAt} - ${requests.firstSubmittedAt}) filter (where ${requests.treatedAt} between ${fromTs} and ${toTs})) * 1000)::float8`,
      p90TreatMs: sql<number>`(extract(epoch from percentile_cont(0.9) within group (order by ${requests.treatedAt} - ${requests.firstSubmittedAt}) filter (where ${requests.treatedAt} between ${fromTs} and ${toTs})) * 1000)::float8`,
    })
    .from(requests)
    .innerJoin(vendors, eq(vendors.id, requests.vendorId))
    .groupBy(vendors.name);
  const byUser = await db
    .select({
      user: users.fullName,
      treated: sql<number>`count(*)::int`,
      avgTreatMs: sql<number>`(extract(epoch from avg(${requests.treatedAt} - ${requests.firstSubmittedAt})) * 1000)::float8`,
    })
    .from(requests)
    .innerJoin(users, eq(users.id, requests.treatedBy))
    .where(and(gte(requests.treatedAt, fromTs), lte(requests.treatedAt, toTs)))
    .groupBy(users.fullName)
    .orderBy(desc(sql`count(*)`));
  const exceptionReasons = await db
    .select({ reason: requests.exceptionReason, n: sql<number>`count(*)::int` })
    .from(requests)
    .where(and(gte(requests.exceptionAt, fromTs), lte(requests.exceptionAt, toTs)))
    .groupBy(requests.exceptionReason)
    .orderBy(desc(sql`count(*)`));
  return {
    from,
    to,
    byVendor: byVendor.map((v) => ({ ...v, exceptionRate: v.received ? v.exceptions / v.received : 0 })),
    byUser,
    exceptionReasons: exceptionReasons.map((e) => ({ ...e, label: e.reason ? EXCEPTION_REASON_LABELS[e.reason] : "—" })),
  };
}

export async function anmReport(actor: Actor, input: unknown) {
  requireReports(actor);
  const { from, to, fromTs, toTs } = range(input);
  const res = await getDb().execute(sql`
    select a.id, a.code, a.full_name as "fullName", a.is_active as "isActive",
      (select count(*)::int from terminal_mappings tm where tm.anm_id = a.id and tm.is_current) as portfolio,
      (select count(*)::int from requests r where r.anm_id = a.id and r.type = 'MAPPING' and r.treated_at between ${fromTs} and ${toTs}) as mapped,
      (select count(*)::int from requests r where r.anm_id = a.id and r.type = 'REMAPPING' and r.treated_at between ${fromTs} and ${toTs}) as remapped,
      (select count(*)::int from requests r where r.anm_id = a.id and r.status in ('DRAFT','READY_FOR_REVIEW','SUBMITTED','IN_PROGRESS','EXCEPTION','RETURNED')) as outstanding
    from anms a order by portfolio desc, a.full_name
  `);
  return { from, to, rows: res.rows as { id: string; code: string; fullName: string; isActive: boolean; portfolio: number; mapped: number; remapped: number; outstanding: number }[] };
}

export async function locationReport(actor: Actor, input: unknown) {
  requireReports(actor);
  const { from, to, fromTs, toTs } = range(input);
  const res = await getDb().execute(sql`
    with states as (
      select state from terminal_mappings where is_current
      union select state from requests
    )
    select s.state,
      (select count(*)::int from terminal_mappings tm where tm.state = s.state and tm.is_current) as terminals,
      (select count(*)::int from requests r where r.state = s.state and r.type = 'MAPPING' and r.treated_at between ${fromTs} and ${toTs}) as mappings,
      (select count(*)::int from requests r where r.state = s.state and r.type = 'REMAPPING' and r.treated_at between ${fromTs} and ${toTs}) as remappings,
      (select count(*)::int from requests r where r.state = s.state and r.status in ('DRAFT','READY_FOR_REVIEW','SUBMITTED','IN_PROGRESS','EXCEPTION','RETURNED')) as outstanding
    from states s order by terminals desc, s.state
  `);
  return { from, to, rows: res.rows as { state: string; terminals: number; mappings: number; remappings: number; outstanding: number }[] };
}

export async function outstandingReport(actor: Actor) {
  requireReports(actor);
  const db = getDb();
  const rows = await db
    .select({
      id: requests.id,
      reference: requests.reference,
      type: requests.type,
      status: requests.status,
      priority: requests.priority,
      serialNumber: requests.serialNumber,
      tid: requests.tid,
      agentName: requests.agentName,
      state: requests.state,
      anmName: requests.anmName,
      createdAt: requests.createdAt,
      submittedAt: requests.submittedAt,
      exceptionReason: requests.exceptionReason,
      ageHours: sql<number>`(extract(epoch from now() - coalesce(${requests.submittedAt}, ${requests.createdAt})) / 3600)::float8`,
    })
    .from(requests)
    .where(inArray(requests.status, OPEN_STATUSES))
    .orderBy(asc(sql`coalesce(${requests.submittedAt}, ${requests.createdAt})`))
    .limit(2000);
  const buckets = { "< 24h": 0, "1–3 days": 0, "3–7 days": 0, "> 7 days": 0 };
  for (const r of rows) {
    if (r.ageHours < 24) buckets["< 24h"]++;
    else if (r.ageHours < 72) buckets["1–3 days"]++;
    else if (r.ageHours < 168) buckets["3–7 days"]++;
    else buckets["> 7 days"]++;
  }
  const byStatus: Record<string, number> = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return { rows, buckets, byStatus };
}

export async function activityReport(actor: Actor, input: unknown) {
  requireReports(actor);
  const { from, to, fromTs, toTs } = range(input);
  const db = getDb();
  const byUser = await db
    .select({
      actorName: workflowEvents.actorName,
      actorRole: workflowEvents.actorRole,
      created: sql<number>`count(*) filter (where ${workflowEvents.action} = 'CREATED')::int`,
      submitted: sql<number>`count(*) filter (where ${workflowEvents.action} in ('SUBMIT_TO_VENDOR','RESUBMIT'))::int`,
      treated: sql<number>`count(*) filter (where ${workflowEvents.action} = 'TREAT')::int`,
      exceptions: sql<number>`count(*) filter (where ${workflowEvents.action} = 'RAISE_EXCEPTION')::int`,
      returned: sql<number>`count(*) filter (where ${workflowEvents.action} = 'RETURN')::int`,
      amended: sql<number>`count(*) filter (where ${workflowEvents.action} = 'AMENDED')::int`,
      total: sql<number>`count(*)::int`,
    })
    .from(workflowEvents)
    .where(and(gte(workflowEvents.createdAt, fromTs), lte(workflowEvents.createdAt, toTs)))
    .groupBy(workflowEvents.actorName, workflowEvents.actorRole)
    .orderBy(desc(sql`count(*)`));
  return { from, to, byUser };
}

/* ───────────────────────────── audit log ───────────────────────────── */

export const auditSearchSchema = z.object({
  q: z.string().max(100).optional(),
  action: z.string().max(64).optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(64).optional(),
  actorId: z.string().uuid().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});

export async function searchAudit(actor: Actor, input: unknown) {
  if (!can(actor.role, "audit:view")) throw forbidden();
  const p = auditSearchSchema.safeParse(input ?? {});
  if (!p.success) throw new AppError("VALIDATION", "Invalid audit search.");
  const f = p.data;
  const conds: SQL[] = [];
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`;
    conds.push(or(ilike(auditLogs.actorEmail, like), ilike(auditLogs.entityLabel, like), ilike(auditLogs.action, like))!);
  }
  if (f.action) conds.push(eq(auditLogs.action, f.action));
  if (f.entityType) conds.push(eq(auditLogs.entityType, f.entityType));
  if (f.entityId) conds.push(eq(auditLogs.entityId, f.entityId));
  if (f.actorId) conds.push(eq(auditLogs.actorId, f.actorId));
  if (f.dateFrom) conds.push(gte(auditLogs.createdAt, new Date(`${f.dateFrom}T00:00:00+01:00`)));
  if (f.dateTo) conds.push(lte(auditLogs.createdAt, new Date(`${f.dateTo}T23:59:59.999+01:00`)));
  const db = getDb();
  const where = conds.length ? and(...conds) : undefined;
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(auditLogs).where(where);
  const rows = await db
    .select()
    .from(auditLogs)
    .where(where)
    .orderBy(desc(auditLogs.id))
    .limit(f.pageSize)
    .offset((f.page - 1) * f.pageSize);
  const actions = await db.selectDistinct({ action: auditLogs.action }).from(auditLogs).orderBy(asc(auditLogs.action));
  return { total, page: f.page, pageSize: f.pageSize, rows, actions: actions.map((a) => a.action) };
}

/* ───────────────────────────── exports ───────────────────────────── */

export async function exportRequests(actor: Actor, input: unknown, opts: { includeFullAccount?: boolean } = {}) {
  if (!can(actor.role, "export:run")) throw forbidden("You are not authorised to export records.");
  const p = searchSchema.safeParse({ ...(input as object), page: 1, pageSize: 1 });
  if (!p.success) throw new AppError("VALIDATION", "Invalid export filter.");
  const fullAccount = !!opts.includeFullAccount && can(actor.role, "account:view_full");
  const db = getDb();
  const creator = alias(users, "creator");
  const submitter = alias(users, "submitter");
  const treater = alias(users, "treater");
  const conds = buildRequestFilters(actor, p.data);
  const rows = await db
    .select({
      r: requests,
      createdByName: creator.fullName,
      submittedByName: submitter.fullName,
      treatedByName: treater.fullName,
      vendorName: vendors.name,
    })
    .from(requests)
    .leftJoin(creator, eq(creator.id, requests.createdBy))
    .leftJoin(submitter, eq(submitter.id, requests.submittedBy))
    .leftJoin(treater, eq(treater.id, requests.treatedBy))
    .leftJoin(vendors, eq(vendors.id, requests.vendorId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(requests.createdAt))
    .limit(50_000);
  const data = rows.map(({ r, ...x }) => ({
    reference: r.reference,
    type: REQUEST_TYPE_LABELS[r.type],
    status: STATUS_LABELS[r.status],
    priority: r.priority,
    serialNumber: r.serialNumber,
    tid: r.tid,
    iswTid: r.iswTid ?? "",
    agentName: r.agentName,
    account: fullAccount ? decrypt(r.accountEnc) : maskAccount(r.accountLast4),
    state: r.state,
    area: r.area ?? "",
    anm: r.anmName,
    reason: r.reason ?? "",
    submittedBy: x.submittedByName ?? "",
    createdBy: x.createdByName ?? "",
    createdAt: r.createdAt,
    submittedAt: r.submittedAt,
    vendor: x.vendorName ?? "",
    treatedBy: x.treatedByName ?? "",
    treatedAt: r.treatedAt,
    treatmentComment: r.treatmentComment ?? "",
    exception: r.exceptionReason ? EXCEPTION_REASON_LABELS[r.exceptionReason] : "",
    exceptionComment: r.exceptionComment ?? "",
  }));
  await writeAudit(db, actor, {
    action: "EXPORT_REQUESTS",
    entityType: "export",
    newValue: { rows: data.length, fullAccount, filters: { ...p.data, accountNumber: p.data.accountNumber ? "(account filter)" : undefined } },
  });
  return buildWorkbook(
    [
      {
        name: "Requests",
        columns: [
          { header: "Request ID", key: "reference", width: 18 },
          { header: "Request Type", key: "type" },
          { header: "Status", key: "status", width: 24 },
          { header: "Priority", key: "priority" },
          { header: "Terminal Serial Number", key: "serialNumber", width: 22 },
          { header: "TID", key: "tid" },
          { header: "ISW TID", key: "iswTid" },
          { header: "Agent/Merchant", key: "agentName", width: 32 },
          { header: "Account Number", key: "account", width: 16 },
          { header: "Location (State)", key: "state" },
          { header: "Area/LGA", key: "area" },
          { header: "ANM", key: "anm", width: 22 },
          { header: "Remapping Reason", key: "reason", width: 24 },
          { header: "Created By", key: "createdBy", width: 20 },
          { header: "Created Date", key: "createdAt", width: 20 },
          { header: "Submitted By", key: "submittedBy", width: 20 },
          { header: "Submitted Date", key: "submittedAt", width: 20 },
          { header: "Vendor", key: "vendor" },
          { header: "Treated By", key: "treatedBy", width: 20 },
          { header: "Treated Date", key: "treatedAt", width: 20 },
          { header: "Treatment Comment", key: "treatmentComment", width: 30 },
          { header: "Exception", key: "exception", width: 22 },
          { header: "Exception Comment", key: "exceptionComment", width: 30 },
        ],
        rows: data,
      },
    ],
    { title: "Wakeel terminal mapping requests export", generatedBy: actor.email },
  );
}

export async function exportTerminals(actor: Actor, input: unknown) {
  if (!can(actor.role, "export:run")) throw forbidden();
  const p = terminalSearchSchema.safeParse({ ...(input as object), page: 1, pageSize: 1 });
  if (!p.success) throw new AppError("VALIDATION", "Invalid export filter.");
  const db = getDb();
  const cm = alias(terminalMappings, "cm");
  const conds = terminalFilters(p.data);
  const rows = await db
    .select({ t: terminals, m: cm })
    .from(terminals)
    .leftJoin(cm, eq(cm.id, terminals.currentMappingId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(terminals.serialNumber))
    .limit(50_000);
  await writeAudit(db, actor, { action: "EXPORT_TERMINALS", entityType: "export", newValue: { rows: rows.length } });
  return buildWorkbook(
    [
      {
        name: "Terminals",
        columns: [
          { header: "Terminal Serial Number", key: "serial", width: 22 },
          { header: "TID", key: "tid" },
          { header: "ISW TID", key: "isw" },
          { header: "Status", key: "status", width: 18 },
          { header: "Current Agent/Merchant", key: "agent", width: 32 },
          { header: "Account Number", key: "account", width: 16 },
          { header: "State", key: "state" },
          { header: "Area/LGA", key: "area" },
          { header: "ANM", key: "anm", width: 22 },
          { header: "Mapping Version", key: "version" },
          { header: "Mapped Date", key: "mappedAt", width: 20 },
          { header: "Last Remapped", key: "remappedAt", width: 20 },
          { header: "Vendor Location", key: "stock" },
          { header: "Legacy Status", key: "legacyStatus" },
          { header: "Legacy Comment", key: "legacyComment", width: 30 },
        ],
        rows: rows.map(({ t, m }) => ({
          serial: t.serialNumber,
          tid: t.tid ?? "",
          isw: t.iswTid ?? "",
          status: TERMINAL_STATUS_LABELS[t.status],
          agent: m?.agentName ?? "",
          account: m ? maskAccount(m.accountLast4) : "",
          state: m?.state ?? "",
          area: m?.area ?? "",
          anm: m?.anmName ?? "",
          version: m?.version ?? "",
          mappedAt: t.mappedAt,
          remappedAt: t.lastRemappedAt,
          stock: t.stockLocation ?? "",
          legacyStatus: t.legacyStatus ?? "",
          legacyComment: t.legacyComment ?? "",
        })),
      },
    ],
    { title: "Wakeel terminal master export", generatedBy: actor.email },
  );
}

export async function exportAudit(actor: Actor, input: unknown) {
  if (!can(actor.role, "audit:view") || !can(actor.role, "export:run")) throw forbidden();
  const db = getDb();
  const parsed = auditSearchSchema.safeParse({ ...(input as object), page: 1, pageSize: 1 });
  if (!parsed.success) throw new AppError("VALIDATION", "Invalid audit filter.");
  const p = parsed.data;
  const conds: SQL[] = [];
  if (p.action) conds.push(eq(auditLogs.action, p.action));
  if (p.dateFrom) conds.push(gte(auditLogs.createdAt, new Date(`${p.dateFrom}T00:00:00+01:00`)));
  if (p.dateTo) conds.push(lte(auditLogs.createdAt, new Date(`${p.dateTo}T23:59:59.999+01:00`)));
  const rows = await db.select().from(auditLogs).where(conds.length ? and(...conds) : undefined).orderBy(desc(auditLogs.id)).limit(50_000);
  await writeAudit(db, actor, { action: "EXPORT_AUDIT", entityType: "export", newValue: { rows: rows.length } });
  return buildWorkbook([
    {
      name: "Audit",
      columns: [
        { header: "#", key: "id", width: 8 },
        { header: "Timestamp", key: "createdAt", width: 22 },
        { header: "User", key: "actorEmail", width: 26 },
        { header: "Role", key: "actorRole", width: 16 },
        { header: "Action", key: "action", width: 28 },
        { header: "Record Type", key: "entityType" },
        { header: "Record", key: "entityLabel", width: 22 },
        { header: "Old Value", key: "oldValue", width: 40 },
        { header: "New Value", key: "newValue", width: 40 },
        { header: "IP", key: "ip" },
        { header: "Hash", key: "hash", width: 20 },
      ],
      rows: rows.map((r) => ({ ...r, oldValue: r.oldValue ? JSON.stringify(r.oldValue) : "", newValue: r.newValue ? JSON.stringify(r.newValue) : "" })),
    },
  ]);
}
