/**
 * DEVELOPMENT SEED DATA — every name, account number, serial and TID below is FICTIONAL test data.
 * Records are created through the real service layer so that workflow history and the audit
 * trail are realistic. Refuses to run in production.
 *
 * Run with: npm run db:seed   (or npm run db:reset to wipe + migrate + seed)
 */
import "dotenv/config";
import { sql } from "drizzle-orm";

export const DEV_PASSWORD = "Wakeel#Dev2026!";

export const SEED_USERS = [
  { email: "superadmin@wakeel.test", fullName: "Sade Superadmin (Test)", role: "SUPER_ADMIN" as const },
  { email: "ops@wakeel.test", fullName: "Ola Operations (Test)", role: "WAKEEL_ADMIN" as const },
  { email: "ops2@wakeel.test", fullName: "Ngozi Operations (Test)", role: "WAKEEL_ADMIN" as const },
  { email: "field@wakeel.test", fullName: "Femi Field Officer (Test)", role: "FIELD_SUBMITTER" as const },
  { email: "vendor@elnexu.test", fullName: "Emeka Elnexu (Test)", role: "VENDOR_USER" as const, vendor: "ELNEXU" },
  { email: "vendor2@elnexu.test", fullName: "Halima Elnexu (Test)", role: "VENDOR_USER" as const, vendor: "ELNEXU" },
];

const ANM_SEED = [
  ["ANM-001", "Adaeze Okafor (Test ANM)", ["Lagos", "Ogun"]],
  ["ANM-002", "Babatunde Adeyemi (Test ANM)", ["Oyo", "Osun", "Ogun"]],
  ["ANM-003", "Chiamaka Eze (Test ANM)", ["Enugu", "Anambra", "Ebonyi"]],
  ["ANM-004", "Danjuma Musa (Test ANM)", ["Kano", "Kaduna", "Jigawa"]],
  ["ANM-005", "Efe Oghene (Test ANM)", ["Delta", "Edo"]],
  ["ANM-006", "Funmilayo Bello (Test ANM)", ["FCT", "Nasarawa", "Niger"]],
  ["ANM-007", "Garba Abdullahi (Test ANM)", ["Sokoto", "Kebbi", "Zamfara"]],
  ["ANM-008", "Ibiere Tamuno (Test ANM)", ["Rivers", "Bayelsa"]],
  ["ANM-009", "Kelechi Nwosu (Test ANM)", ["Imo", "Abia"]],
  ["ANM-010", "Retired Test ANM (Inactive)", ["Lagos"]],
] as const;

const AGENT_WORDS = ["TANTA", "BRIGHT", "GOLDEN", "ROYAL", "UNITY", "PEACE", "NOBLE", "SUMMIT", "HARVEST", "CROWN", "VICTORY", "PRIME", "ZENITH", "BLESSED", "STAR"];
const AGENT_SUFFIX = ["DYNAMIC ENTERPRISE", "VENTURES", "STORES", "GLOBAL SERVICES", "POS HUB", "MERCHANTS", "TRADING CO", "NIG ENTERPRISES"];
const STATES_POOL = ["Lagos", "Ogun", "Oyo", "Rivers", "Kano", "FCT", "Enugu", "Delta", "Kaduna", "Anambra", "Imo", "Edo"];

/** Deterministic PRNG so the seed is reproducible. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

export async function seed() {
  if (process.env.NODE_ENV === "production") throw new Error("Seeding is disabled in production. Use scripts/create-admin.ts.");
  const { getDb, closeDb } = await import("../src/server/db/client");
  const schema = await import("../src/server/db/schema");
  const { hashPassword } = await import("../src/server/auth/password");
  const svc = await import("../src/server/services/requests");
  const imports = await import("../src/server/services/imports");
  const { writeAudit } = await import("../src/server/audit");
  const db = getDb();
  const rand = rng(20261116);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rand() * a.length)];

  const [existing] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  if (existing.n > 0) {
    console.log("Database already has users — skipping seed. Use npm run db:reset for a clean dev database.");
    await closeDb();
    return;
  }

  const sys = { id: null, email: "system/seed", role: "SYSTEM" };
  const [elnexu] = await db.insert(schema.vendors).values({ code: "ELNEXU", name: "Elnexu", contactEmail: "support@elnexu.test" }).returning();
  await writeAudit(db, sys, { action: "VENDOR_CREATED", entityType: "vendor", entityId: elnexu.id, entityLabel: "Elnexu" });

  const hash = await hashPassword(DEV_PASSWORD);
  const userIds: Record<string, string> = {};
  for (const u of SEED_USERS) {
    const [row] = await db
      .insert(schema.users)
      .values({ email: u.email, fullName: u.fullName, role: u.role, vendorId: "vendor" in u ? elnexu.id : null, passwordHash: hash, passwordChangedAt: new Date() })
      .returning();
    userIds[u.email] = row.id;
    await writeAudit(db, sys, { action: "USER_CREATED", entityType: "user", entityId: row.id, entityLabel: u.email, newValue: { role: u.role } });
  }
  const actorOf = (email: string) => {
    const u = SEED_USERS.find((x) => x.email === email)!;
    return { id: userIds[email], email, fullName: u.fullName, role: u.role, vendorId: "vendor" in u ? elnexu.id : null, ip: "127.0.0.1", userAgent: "seed" };
  };
  const ops = actorOf("ops@wakeel.test");
  const ops2 = actorOf("ops2@wakeel.test");
  const field = actorOf("field@wakeel.test");
  const vendor = actorOf("vendor@elnexu.test");
  const vendor2 = actorOf("vendor2@elnexu.test");
  const admin = actorOf("superadmin@wakeel.test");

  const anmIds: string[] = [];
  for (const [code, name, regions] of ANM_SEED) {
    const [a] = await db
      .insert(schema.anms)
      .values({ code, fullName: name, email: `${code.toLowerCase()}@wakeel.test`, regions: [...regions], isActive: code !== "ANM-010" })
      .returning();
    if (a.isActive) anmIds.push(a.id);
    await writeAudit(db, sys, { action: "ANM_CREATED", entityType: "anm", entityId: a.id, entityLabel: name });
  }

  // 1) Vendor terminal/TID batch — imported through the real Excel import pipeline (CSV form of the legacy sheet).
  const stockLines = ["Location,Terminal Serial Number,Current TID,ISW TID,Status/Comment"];
  for (let i = 0; i < 70; i++) {
    const serial = `16624261${String(10000 + i * 37).padStart(5, "0")}`;
    const tid = `2WKL${String(1100 + i).padStart(4, "0")}`;
    const isw = `2ISA${String(5000 + i)}`;
    const comment = i % 17 === 0 ? "Having EOD Issues" : i % 5 === 0 ? "Done" : "";
    stockLines.push(`${pick(STATES_POOL)},${serial},${tid},${isw},${comment}`);
  }
  const up = await imports.uploadBatch(admin, "TERMINAL_STOCK", "elnexu-tid-batch-sample.csv", Buffer.from(stockLines.join("\n")));
  await imports.validateBatch(admin, up.batchId);
  await imports.commitBatch(admin, up.batchId);
  const stock = await db.select().from(schema.terminals).orderBy(schema.terminals.serialNumber);

  const account = () => {
    let a = "";
    while (!/^\d{10}$/.test(a) || /^(\d)\1{9}$/.test(a)) a = `90${Math.floor(rand() * 1e8).toString().padStart(8, "0")}`;
    return a;
  };
  const agentName = () => `${pick(AGENT_WORDS)} ${pick(AGENT_SUFFIX)} (TEST)`;
  const mk = (t: (typeof stock)[number], by = ops) =>
    svc.createMappingRequest(by, {
      serialNumber: t.serialNumber,
      tid: t.tid!,
      iswTid: t.iswTid,
      agentName: agentName(),
      accountNumber: account(),
      state: pick(STATES_POOL),
      area: null,
      anmId: pick(anmIds),
      priority: rand() < 0.15 ? "HIGH" : "NORMAL",
      internalComment: null,
    } as never);

  const created: { id: string; daysAgo: number }[] = [];
  let idx = 0;
  // 28 treated mappings, spread over the last 14 days (12 closed)
  for (let i = 0; i < 28; i++, idx++) {
    const r = await mk(stock[idx], i % 4 === 0 ? field : ops);
    await svc.submitToVendor(i % 2 ? ops : ops2, r.id, true, { notify: false });
    await svc.startTreatment(i % 3 ? vendor : vendor2, r.id);
    await svc.markTreated(i % 3 ? vendor : vendor2, r.id, true, i % 6 === 0 ? "Mapped on TMS; terminal re-initialised." : null, { notify: false });
    if (i < 12) await svc.closeRequest(ops, r.id);
    created.push({ id: r.id, daysAgo: 1 + Math.floor((i / 28) * 13) });
  }
  // Remappings on treated terminals (history: v1 → v2), 4 treated, 2 pending with vendor, 1 ready for review
  const mapped = await db.select().from(schema.terminals).where(sql`${schema.terminals.currentMappingId} is not null`).orderBy(schema.terminals.serialNumber);
  for (let i = 0; i < 7; i++) {
    const t = mapped[i];
    const r = await svc.createRemappingRequest(i === 6 ? field : ops, {
      terminalId: t.id,
      agentName: agentName(),
      accountNumber: account(),
      state: pick(STATES_POOL),
      area: null,
      anmId: pick(anmIds),
      priority: "NORMAL",
      reason: pick(["Agent relocated to a new outlet", "Original agent exited the network", "Terminal reassigned by ANM"]),
      internalComment: null,
    } as never);
    if (i < 6) await svc.submitToVendor(ops, r.id, true, { notify: false });
    if (i < 4) {
      await svc.markTreated(vendor, r.id, true, null, { notify: false });
      created.push({ id: r.id, daysAgo: i });
    }
  }
  // Pending with vendor
  for (let i = 0; i < 9; i++, idx++) {
    const r = await mk(stock[idx]);
    await svc.submitToVendor(ops, r.id, true, { notify: false });
    if (i < 2) await svc.startTreatment(vendor, r.id);
  }
  // Exceptions
  const ex1 = await mk(stock[idx++]);
  await svc.submitToVendor(ops, ex1.id, true, { notify: false });
  await svc.raiseException(vendor, ex1.id, { reason: "ACCOUNT_INVALID", comment: "Account name on TMS does not match agent name." });
  const ex2 = await mk(stock[idx++]);
  await svc.submitToVendor(ops, ex2.id, true, { notify: false });
  await svc.raiseException(vendor2, ex2.id, { reason: "TMS_ERROR", comment: "TMS timed out while saving profile." });
  // Returned for correction
  const ret = await mk(stock[idx++], field);
  await svc.submitToVendor(ops, ret.id, true, { notify: false });
  await svc.raiseException(vendor, ret.id, { reason: "TID_UNAVAILABLE", comment: null });
  await svc.returnRequest(ops, ret.id, "Please confirm the TID with the field officer.");
  // Ready for review (from field) and drafts
  for (let i = 0; i < 4; i++, idx++) await mk(stock[idx], field);
  for (let i = 0; i < 2; i++, idx++) {
    await svc.createMappingRequest(field, {
      serialNumber: stock[idx].serialNumber, tid: stock[idx].tid!, iswTid: null, agentName: agentName(), accountNumber: account(),
      state: pick(STATES_POOL), area: null, anmId: pick(anmIds), priority: "NORMAL", internalComment: "Waiting for agent's BVN confirmation.",
    } as never, { asDraft: true });
  }
  // A cancelled one
  const can = await mk(stock[idx++]);
  await svc.cancelRequest(ops, can.id, "Agent withdrew from the Wakeel programme.");

  // Spread treated activity over the last two weeks for realistic charts/reports. Workflow-event
  // immutability triggers are disabled only for this dev-seed backdating, then re-enabled.
  // (The audit trail is NOT backdated — it records the real seeding time.)
  await db.execute(sql`alter table workflow_events disable trigger workflow_events_no_update`);
  for (const c of created) {
    if (c.daysAgo === 0) continue;
    const iv = sql.raw(`interval '${c.daysAgo} days'`);
    await db.execute(sql`update requests set created_at = created_at - ${iv}, submitted_at = submitted_at - ${iv}, first_submitted_at = first_submitted_at - ${iv},
      reviewed_at = reviewed_at - ${iv}, started_at = started_at - ${iv}, treated_at = treated_at - ${iv} + (random() * interval '20 hours'),
      closed_at = closed_at - ${iv} + interval '22 hours', updated_at = now() where id = ${c.id}`);
    await db.execute(sql`update workflow_events set created_at = created_at - ${iv} where request_id = ${c.id}`);
    await db.execute(sql`update terminal_mappings set effective_from = effective_from - ${iv} where request_id = ${c.id}`);
  }
  await db.execute(sql`update terminals t set mapped_at = (select min(effective_from) from terminal_mappings m where m.terminal_id = t.id) where current_mapping_id is not null`);
  await db.execute(sql`alter table workflow_events enable trigger workflow_events_no_update`);

  console.log(`Seed complete. Dev users (password "${DEV_PASSWORD}"):`);
  for (const u of SEED_USERS) console.log(`  ${u.role.padEnd(16)} ${u.email}`);
  await closeDb();
}

if (require.main === module) {
  seed()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
