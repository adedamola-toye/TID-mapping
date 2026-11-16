import { randomBytes } from "node:crypto";
import { getDb } from "@/server/db/client";
import { anms, users, vendors } from "@/server/db/schema";
import { hashPassword } from "@/server/auth/password";
import type { Actor } from "@/server/actor";
import type { Role } from "@/lib/constants";
import { eq } from "drizzle-orm";

export const PASSWORD = "Test#Password2026!";
let hashCache: string | null = null;

const uniq = () => randomBytes(4).toString("hex");

let counter = Math.floor(Math.random() * 90000);
/** Unique fake serial + TID per call (TIDs are 8 chars). */
export function newTerminalIds() {
  counter++;
  const n = String(counter).padStart(6, "0");
  const r = randomBytes(1).toString("hex").toUpperCase();
  return { serialNumber: `TST${r}${n}`, tid: `T${r}${n.slice(1)}`.slice(0, 8).padEnd(8, "0") };
}

export function fakeAccount() {
  let a = "";
  while (!/^\d{10}$/.test(a) || /^(\d)\1{9}$/.test(a)) a = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
  return a;
}

export async function makeVendor(code = `V${uniq()}`.toUpperCase()) {
  const [v] = await getDb().insert(vendors).values({ code, name: `Vendor ${code}` }).returning();
  return v;
}

export async function ensureDefaultVendor() {
  const db = getDb();
  const [v] = await db.select().from(vendors).where(eq(vendors.code, "ELNEXU"));
  if (v) return v;
  const [nv] = await db.insert(vendors).values({ code: "ELNEXU", name: "Elnexu" }).onConflictDoNothing().returning();
  if (nv) return nv;
  return (await db.select().from(vendors).where(eq(vendors.code, "ELNEXU")))[0];
}

export async function makeUser(role: Role, opts: { vendorId?: string; email?: string; isActive?: boolean } = {}): Promise<Actor> {
  hashCache ??= await hashPassword(PASSWORD);
  const email = opts.email ?? `${role.toLowerCase()}-${uniq()}@test.local`;
  const [u] = await getDb()
    .insert(users)
    .values({ email, fullName: `${role} ${uniq()}`, role, vendorId: role === "VENDOR_USER" ? opts.vendorId! : null, passwordHash: hashCache, isActive: opts.isActive ?? true })
    .returning();
  return { id: u.id, email: u.email, fullName: u.fullName, role: u.role, vendorId: u.vendorId, ip: "127.0.0.1", userAgent: "vitest" };
}

export async function makeAnm(isActive = true) {
  const code = `ANM-${uniq()}`.toUpperCase();
  const [a] = await getDb().insert(anms).values({ code, fullName: `Test ANM ${code}`, isActive }).returning();
  return a;
}

export async function world() {
  const vendor = await ensureDefaultVendor();
  const otherVendor = await makeVendor();
  return {
    vendor,
    otherVendor,
    admin: await makeUser("SUPER_ADMIN"),
    ops: await makeUser("WAKEEL_ADMIN"),
    field: await makeUser("FIELD_SUBMITTER"),
    field2: await makeUser("FIELD_SUBMITTER"),
    vendorUser: await makeUser("VENDOR_USER", { vendorId: vendor.id }),
    otherVendorUser: await makeUser("VENDOR_USER", { vendorId: otherVendor.id }),
    anm: await makeAnm(),
    anm2: await makeAnm(),
    inactiveAnm: await makeAnm(false),
  };
}

export function mappingInput(anmId: string, over: Record<string, unknown> = {}) {
  const ids = newTerminalIds();
  return {
    serialNumber: ids.serialNumber,
    tid: ids.tid,
    iswTid: null,
    agentName: "TEST AGENT ENTERPRISE",
    accountNumber: fakeAccount(),
    state: "Lagos",
    area: "Ikeja",
    anmId,
    priority: "NORMAL",
    internalComment: "internal note — not for vendor",
    ...over,
  };
}
