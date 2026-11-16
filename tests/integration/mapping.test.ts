import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { auditLogs, requests, terminalMappings, terminals, workflowEvents } from "@/server/db/schema";
import * as svc from "@/server/services/requests";
import { AppError } from "@/server/errors";
import { world, mappingInput, fakeAccount, newTerminalIds } from "../fixtures";

let w: Awaited<ReturnType<typeof world>>;
beforeAll(async () => {
  w = await world();
});

async function expectAppError(p: Promise<unknown>, code: string, msg?: RegExp) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe(code);
    if (msg) expect((e as AppError).message).toMatch(msg);
    return e as AppError;
  }
  throw new Error(`Expected AppError ${code}`);
}

describe("NEW MAPPING — critical acceptance flow", () => {
  it("internal create → submit → vendor sees → opens → copies → treats → internal sees TREATED → full audit", async () => {
    const input = mappingInput(w.anm.id, { iswTid: "2ISW0001" });
    // Internal user creates the request
    const r = await svc.createMappingRequest(w.ops, input);
    expect(r.status).toBe("READY_FOR_REVIEW");
    expect(r.reference).toMatch(/^WKL-MAP-\d{6}$/);

    // Vendor cannot see it before release
    await expectAppError(svc.getRequestDetail(w.vendorUser, r.id), "NOT_FOUND");
    const before = await svc.searchRequests(w.vendorUser, { q: input.serialNumber });
    expect(before.total).toBe(0);

    // Submit requires explicit review confirmation
    await expectAppError(svc.submitToVendor(w.ops, r.id, false), "VALIDATION", /confirm/i);
    const sub = await svc.submitToVendor(w.ops, r.id, true);
    expect(sub.request.status).toBe("SUBMITTED");

    // Vendor sees it in the queue
    const queue = await svc.searchRequests(w.vendorUser, { status: ["SUBMITTED", "IN_PROGRESS"], q: input.serialNumber });
    expect(queue.total).toBe(1);
    expect(queue.rows[0].account).toMatch(/^••••••\d{4}$/);
    expect(queue.rows[0].createdByName).toBe("Wakeel Operations");

    // Vendor opens: full payload available for TMS, but no internal data
    await svc.recordVendorOpened(w.vendorUser, r.id);
    const detail = await svc.getRequestDetail(w.vendorUser, r.id);
    expect(detail.accountFull).toBe(input.accountNumber);
    expect(detail.internalComment).toBeNull();
    expect(detail.terminalId).toBeUndefined();
    expect(detail.vendorOpenedAt).not.toBeNull();
    expect(detail.permissions.treat).toBe(true);
    expect(detail.permissions.edit).toBe(false);
    expect(detail.events.every((e) => e.action !== "CREATED")).toBe(true); // internal-only events hidden

    // Vendor copies
    await svc.recordCopy(w.vendorUser, r.id, "copyAll");

    // Vendor marks treated (requires TMS confirmation)
    await expectAppError(svc.markTreated(w.vendorUser, r.id, false, null), "VALIDATION", /TMS/);
    const treated = await svc.markTreated(w.vendorUser, r.id, true, "Done on TMS");
    expect(treated.request.status).toBe("TREATED");
    expect(treated.request.treatedBy).toBe(w.vendorUser.id);
    expect(treated.request.treatedAt).toBeInstanceOf(Date);

    // Internal immediately sees TREATED
    const internal = await svc.getRequestDetail(w.ops, r.id);
    expect(internal.status).toBe("TREATED");
    expect(internal.treatedByName).toBe(w.vendorUser.fullName);
    expect(internal.treatmentComment).toBe("Done on TMS");

    // Terminal master now reflects mapping version 1
    const db = getDb();
    const [t] = await db.select().from(terminals).where(eq(terminals.serialNumber, input.serialNumber));
    expect(t.status).toBe("MAPPED");
    const [m] = await db.select().from(terminalMappings).where(eq(terminalMappings.terminalId, t.id));
    expect(m.version).toBe(1);
    expect(m.isCurrent).toBe(true);
    expect(m.agentName).toBe("TEST AGENT ENTERPRISE");
    expect(m.accountEnc).not.toContain(input.accountNumber);

    // Timeline
    const ev = await db.select().from(workflowEvents).where(eq(workflowEvents.requestId, r.id)).orderBy(workflowEvents.id);
    expect(ev.map((e) => e.action)).toEqual(["CREATED", "SUBMIT_TO_VENDOR", "VENDOR_OPENED", "TREAT"]);

    // Audit trail answers who/when/what
    const audit = await db.select().from(auditLogs).where(and(eq(auditLogs.entityType, "request"), eq(auditLogs.entityId, r.id))).orderBy(auditLogs.id);
    const actions = audit.map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["REQUEST_CREATED", "REQUEST_SUBMIT_TO_VENDOR", "VENDOR_OPENED_REQUEST", "VENDOR_COPIED_DATA", "REQUEST_TREAT"]));
    const created = audit.find((a) => a.action === "REQUEST_CREATED")!;
    expect(created.actorId).toBe(w.ops.id);
    expect(created.actorRole).toBe("WAKEEL_ADMIN");
    expect(JSON.stringify(created.newValue)).not.toContain(input.accountNumber); // masked
    const treat = audit.find((a) => a.action === "REQUEST_TREAT")!;
    expect(treat.actorId).toBe(w.vendorUser.id);
    expect(treat.actorRole).toBe("VENDOR_USER");
    // No audit row contains the plaintext account number
    expect(JSON.stringify(audit)).not.toContain(input.accountNumber);

    // Close
    const closed = await svc.closeRequest(w.ops, r.id);
    expect(closed.request.status).toBe("CLOSED");
  });
});

describe("mapping validation & duplicate prevention", () => {
  it("rejects missing required fields with field-level messages", async () => {
    const e = await expectAppError(svc.createMappingRequest(w.ops, { serialNumber: "", tid: "", agentName: "", accountNumber: "", state: "", anmId: "" }), "VALIDATION");
    expect(Object.keys(e.fieldErrors!)).toEqual(expect.arrayContaining(["serialNumber", "tid", "agentName", "accountNumber", "state", "anmId"]));
  });
  it("rejects invalid account numbers", async () => {
    const e = await expectAppError(svc.createMappingRequest(w.ops, mappingInput(w.anm.id, { accountNumber: "12345" })), "VALIDATION");
    expect(e.fieldErrors!.accountNumber).toMatch(/10 digits/);
  });
  it("rejects inactive / unknown ANMs", async () => {
    await expectAppError(svc.createMappingRequest(w.ops, mappingInput(w.inactiveAnm.id)), "VALIDATION", /active ANM/);
    await expectAppError(svc.createMappingRequest(w.ops, mappingInput("00000000-0000-4000-8000-000000000000")), "VALIDATION", /active ANM/);
  });
  it("prevents a second request for a terminal that already has a pending request", async () => {
    const input = mappingInput(w.anm.id);
    await svc.createMappingRequest(w.ops, input);
    await expectAppError(svc.createMappingRequest(w.ops, { ...input, agentName: "OTHER AGENT" }), "CONFLICT", /already has a pending mapping request/);
  });
  it("prevents a TID being assigned to two terminals", async () => {
    const a = mappingInput(w.anm.id);
    await svc.createMappingRequest(w.ops, a);
    const b = mappingInput(w.anm.id, { tid: a.tid });
    const e = await expectAppError(svc.createMappingRequest(w.ops, b), "CONFLICT", /already assigned/);
    expect(e.fieldErrors?.tid).toBeTruthy();
  });
  it("rejects a TID that does not match the terminal's registered TID", async () => {
    const a = mappingInput(w.anm.id);
    const r = await svc.createMappingRequest(w.ops, a);
    await svc.cancelRequest(w.ops, r.id, "test cancel");
    const other = newTerminalIds();
    await expectAppError(svc.createMappingRequest(w.ops, { ...a, tid: other.tid }), "CONFLICT", /registered with TID/);
  });
  it("refuses a new mapping for an already-mapped terminal (must use remapping)", async () => {
    const a = mappingInput(w.anm.id);
    const r = await svc.createMappingRequest(w.ops, a);
    await svc.submitToVendor(w.ops, r.id, true);
    await svc.markTreated(w.vendorUser, r.id, true, null);
    await expectAppError(svc.createMappingRequest(w.ops, { ...a, agentName: "NEW AGENT" }), "CONFLICT", /active mapping/);
  });
  it("cancelling frees the terminal for a new request", async () => {
    const a = mappingInput(w.anm.id);
    const r = await svc.createMappingRequest(w.ops, a);
    await svc.cancelRequest(w.ops, r.id, "wrong agent");
    const r2 = await svc.createMappingRequest(w.ops, { ...a, agentName: "CORRECT AGENT" });
    expect(r2.status).toBe("READY_FOR_REVIEW");
  });
  it("only one of two concurrent creations for the same terminal succeeds", async () => {
    const a = mappingInput(w.anm.id);
    const results = await Promise.allSettled([
      svc.createMappingRequest(w.ops, a),
      svc.createMappingRequest(w.field, { ...a, agentName: "RACING AGENT" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(AppError);
    expect((rejected.reason as AppError).code).toBe("CONFLICT");
  });
});

describe("field submitter permissions", () => {
  it("can create and see own requests but cannot release to vendor", async () => {
    const r = await svc.createMappingRequest(w.field, mappingInput(w.anm.id), { asDraft: true });
    expect(r.status).toBe("DRAFT");
    await svc.markReady(w.field, r.id);
    await expectAppError(svc.submitToVendor(w.field, r.id, true), "FORBIDDEN");
    const mine = await svc.searchRequests(w.field, {});
    expect(mine.rows.every((x) => x.createdByName === w.field.fullName)).toBe(true);
  });
  it("cannot see another submitter's request (IDOR)", async () => {
    const r = await svc.createMappingRequest(w.field, mappingInput(w.anm.id));
    await expectAppError(svc.getRequestDetail(w.field2, r.id), "NOT_FOUND");
    await expectAppError(svc.updateRequest(w.field2, r.id, { agentName: "HIJACK" }), "NOT_FOUND");
    await expectAppError(svc.revealAccount(w.field2, r.id), "NOT_FOUND");
  });
  it("cannot alter a request after it is treated", async () => {
    const r = await svc.createMappingRequest(w.field, mappingInput(w.anm.id));
    await svc.submitToVendor(w.ops, r.id, true);
    await svc.markTreated(w.vendorUser, r.id, true, null);
    await expectAppError(svc.updateRequest(w.field, r.id, { agentName: "CHANGED" }), "INVALID_STATE");
    await expectAppError(svc.cancelRequest(w.field, r.id, "nope"), "FORBIDDEN");
  });
});

describe("edits, amendments and exceptions", () => {
  it("edits before release are audited with old/new values", async () => {
    const r = await svc.createMappingRequest(w.ops, mappingInput(w.anm.id));
    await svc.updateRequest(w.ops, r.id, { anmId: w.anm2.id });
    const [a] = await getDb().select().from(auditLogs).where(and(eq(auditLogs.entityId, r.id), eq(auditLogs.action, "REQUEST_UPDATED")));
    expect(a.oldValue).toMatchObject({ anm: w.anm.fullName });
    expect(a.newValue).toMatchObject({ anm: w.anm2.fullName });
  });
  it("rejects stale edits (optimistic concurrency)", async () => {
    const r = await svc.createMappingRequest(w.ops, mappingInput(w.anm.id));
    await svc.updateRequest(w.ops, r.id, { agentName: "FIRST EDIT", expectedVersion: r.rowVersion });
    await expectAppError(svc.updateRequest(w.ops, r.id, { agentName: "STALE EDIT", expectedVersion: r.rowVersion }), "CONFLICT");
  });
  it("after release, changes require a controlled amendment with a reason; identifiers cannot be amended", async () => {
    const r = await svc.createMappingRequest(w.ops, mappingInput(w.anm.id));
    await svc.submitToVendor(w.ops, r.id, true);
    await expectAppError(svc.updateRequest(w.ops, r.id, { agentName: "UNCONTROLLED" }), "INVALID_STATE");
    await expectAppError(svc.amendRequest(w.ops, r.id, { agentName: "AMENDED AGENT" }), "VALIDATION", /reason/);
    await expectAppError(svc.amendRequest(w.ops, r.id, { tid: "ZZZZ9999", reason: "typo" }), "VALIDATION", /identifiers/i);
    const a = await svc.amendRequest(w.ops, r.id, { agentName: "AMENDED AGENT", reason: "Agent name corrected per CAC certificate" });
    expect(a.agentName).toBe("AMENDED AGENT");
    expect(a.status).toBe("SUBMITTED");
    const d = await svc.getRequestDetail(w.vendorUser, r.id);
    expect(d.events.find((e) => e.action === "AMENDED")?.comment).toMatch(/CAC/);
    // vendor cannot amend
    await expectAppError(svc.amendRequest(w.vendorUser, r.id, { agentName: "VENDOR EDIT", reason: "x x x" }), "FORBIDDEN");
  });
  it("amendment is blocked while the vendor is treating", async () => {
    const r = await svc.createMappingRequest(w.ops, mappingInput(w.anm.id));
    await svc.submitToVendor(w.ops, r.id, true);
    await svc.startTreatment(w.vendorUser, r.id);
    await expectAppError(svc.amendRequest(w.ops, r.id, { agentName: "LATE", reason: "late change" }), "INVALID_STATE", /currently treating/);
  });
  it("vendor exception → internal return → correction → resubmit → treated", async () => {
    const r = await svc.createMappingRequest(w.ops, mappingInput(w.anm.id));
    await svc.submitToVendor(w.ops, r.id, true);
    await expectAppError(svc.raiseException(w.vendorUser, r.id, { reason: "OTHER" }), "VALIDATION");
    const ex = await svc.raiseException(w.vendorUser, r.id, { reason: "ACCOUNT_INVALID", comment: "Name mismatch" });
    expect(ex.request.status).toBe("EXCEPTION");
    // Exception cannot be silently treated
    await expectAppError(svc.markTreated(w.vendorUser, r.id, true, null), "INVALID_STATE");
    await svc.returnRequest(w.ops, r.id, "Field officer to confirm account");
    await svc.updateRequest(w.ops, r.id, { accountNumber: fakeAccount() });
    await svc.submitToVendor(w.ops, r.id, true);
    const t = await svc.markTreated(w.vendorUser, r.id, true, null);
    expect(t.request.status).toBe("TREATED");
    expect(t.request.exceptionCount).toBe(1);
    const d = await svc.getRequestDetail(w.ops, r.id);
    expect(d.events.map((e) => e.action)).toEqual(["CREATED", "SUBMIT_TO_VENDOR", "RAISE_EXCEPTION", "RETURN", "UPDATED", "SUBMIT_TO_VENDOR", "TREAT"]);
  });
});

describe("vendor isolation", () => {
  it("another vendor cannot see or treat requests", async () => {
    const r = await svc.createMappingRequest(w.ops, mappingInput(w.anm.id));
    await svc.submitToVendor(w.ops, r.id, true);
    await expectAppError(svc.getRequestDetail(w.otherVendorUser, r.id), "NOT_FOUND");
    await expectAppError(svc.markTreated(w.otherVendorUser, r.id, true, null), "NOT_FOUND");
    const q = await svc.searchRequests(w.otherVendorUser, {});
    expect(q.rows.find((x) => x.id === r.id)).toBeUndefined();
  });
  it("vendor cannot see drafts, ready-for-review, returned or cancelled records even by filter", async () => {
    const r = await svc.createMappingRequest(w.ops, mappingInput(w.anm.id));
    const q = await svc.searchRequests(w.vendorUser, { status: ["READY_FOR_REVIEW", "DRAFT", "RETURNED", "CANCELLED"] });
    expect(q.total).toBe(0);
    await expectAppError(svc.getRequestDetail(w.vendorUser, r.id), "NOT_FOUND");
  });
  it("internal users cannot perform vendor treatment", async () => {
    const r = await svc.createMappingRequest(w.ops, mappingInput(w.anm.id));
    await svc.submitToVendor(w.ops, r.id, true);
    await expectAppError(svc.markTreated(w.ops, r.id, true, null), "FORBIDDEN");
    await expectAppError(svc.markTreated(w.admin, r.id, true, null), "FORBIDDEN");
  });
  it("vendor loses full account visibility once treated", async () => {
    const input = mappingInput(w.anm.id);
    const r = await svc.createMappingRequest(w.ops, input);
    await svc.submitToVendor(w.ops, r.id, true);
    await svc.markTreated(w.vendorUser, r.id, true, null);
    const d = await svc.getRequestDetail(w.vendorUser, r.id);
    expect(d.accountFull).toBeNull();
    await expectAppError(svc.revealAccount(w.vendorUser, r.id), "FORBIDDEN");
  });
  it("search treats SQL metacharacters as plain text", async () => {
    const q = await svc.searchRequests(w.ops, { q: "'; drop table requests; --" });
    expect(q.total).toBe(0);
    const q2 = await svc.searchRequests(w.ops, { q: "%" });
    expect(q2.total).toBe(0);
    const [{ n }] = (await getDb().execute(`select count(*)::int as n from requests`)).rows as { n: number }[];
    expect(n).toBeGreaterThan(0);
  });
});

describe("bulk operations", () => {
  it("bulk submit and bulk treat report per-record results", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await svc.createMappingRequest(w.ops, mappingInput(w.anm.id))).id);
    const draft = await svc.createMappingRequest(w.ops, mappingInput(w.anm.id));
    const sub = await svc.bulkSubmitToVendor(w.ops, ids, true);
    expect(sub.succeeded).toHaveLength(5);
    const treat = await svc.bulkMarkTreated(w.vendorUser, [...ids, draft.id], true, "batch treated");
    expect(treat.succeeded).toHaveLength(5);
    expect(treat.failed).toHaveLength(1);
    expect(treat.failed[0].id).toBe(draft.id);
    const rows = await getDb().select({ s: requests.status }).from(requests).where(eq(requests.id, ids[0]));
    expect(rows[0].s).toBe("TREATED");
  });
});
