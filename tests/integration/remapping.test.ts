import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { terminalMappings, terminals, auditLogs } from "@/server/db/schema";
import * as svc from "@/server/services/requests";
import { lookupForRemap, getTerminalDetail } from "@/server/services/terminals";
import { AppError } from "@/server/errors";
import { decrypt } from "@/server/crypto";
import { world, mappingInput, fakeAccount } from "../fixtures";

let w: Awaited<ReturnType<typeof world>>;
beforeAll(async () => {
  w = await world();
});

async function mappedTerminal() {
  const input = mappingInput(w.anm.id, { agentName: "ABC ENTERPRISE", state: "Lagos" });
  const r = await svc.createMappingRequest(w.ops, input);
  await svc.submitToVendor(w.ops, r.id, true);
  await svc.markTreated(w.vendorUser, r.id, true, null);
  const [t] = await getDb().select().from(terminals).where(eq(terminals.serialNumber, input.serialNumber));
  return { t, input };
}

async function err(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected error");
}

describe("REMAPPING — critical acceptance flow", () => {
  it("retrieves current mapping, remaps without changing serial/TID, preserves history", async () => {
    const { t, input } = await mappedTerminal();

    // Look up by TID or serial → current mapping
    const byTid = await lookupForRemap(w.ops, input.tid.toLowerCase());
    expect(byTid.terminal.serialNumber).toBe(input.serialNumber);
    expect(byTid.current?.agentName).toBe("ABC ENTERPRISE");
    expect(byTid.current?.account).toMatch(/^••••••/);
    expect(byTid.blocker).toBeNull();
    const bySerial = await lookupForRemap(w.ops, input.serialNumber);
    expect(bySerial.terminal.id).toBe(t.id);

    const newAccount = fakeAccount();
    const r = await svc.createRemappingRequest(w.ops, {
      terminalId: t.id,
      agentName: "XYZ ENTERPRISE",
      accountNumber: newAccount,
      state: "Ogun",
      area: null,
      anmId: w.anm2.id,
      reason: "Agent relocated",
    });
    expect(r.type).toBe("REMAPPING");
    expect(r.serialNumber).toBe(t.serialNumber);
    expect(r.tid).toBe(t.tid);

    // Terminal is locked by the pending remap
    const blocked = await lookupForRemap(w.ops, input.serialNumber);
    expect(blocked.blocker).toMatch(/pending remapping/);

    await svc.submitToVendor(w.ops, r.id, true);
    const vd = await svc.getRequestDetail(w.vendorUser, r.id);
    expect(vd.type).toBe("REMAPPING");
    expect(vd.previous?.agentName).toBe("ABC ENTERPRISE");
    expect(vd.accountFull).toBe(newAccount);
    expect(vd.reason).toBeNull(); // internal reason hidden from vendor

    await svc.markTreated(w.vendorUser, r.id, true, "Remapped on TMS");

    // History: both versions preserved
    const versions = await getDb().select().from(terminalMappings).where(eq(terminalMappings.terminalId, t.id)).orderBy(terminalMappings.version);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, agentName: "ABC ENTERPRISE", state: "Lagos", isCurrent: false, anmName: w.anm.fullName });
    expect(versions[0].effectiveTo).not.toBeNull();
    expect(decrypt(versions[0].accountEnc)).toBe(input.accountNumber);
    expect(versions[1]).toMatchObject({ version: 2, agentName: "XYZ ENTERPRISE", state: "Ogun", isCurrent: true, anmName: w.anm2.fullName });
    expect(decrypt(versions[1].accountEnc)).toBe(newAccount);

    const [t2] = await getDb().select().from(terminals).where(eq(terminals.id, t.id));
    expect(t2.serialNumber).toBe(t.serialNumber);
    expect(t2.tid).toBe(t.tid);
    expect(t2.currentMappingId).toBe(versions[1].id);
    expect(t2.lastRemappedAt).not.toBeNull();
    expect(t2.status).toBe("MAPPED");

    // Terminal lifecycle view shows previous + new, who requested, who treated, when, why
    const detail = await getTerminalDetail(w.ops, t.id);
    expect(detail.mappings).toHaveLength(2);
    const v2 = detail.mappings[0];
    expect(v2.version).toBe(2);
    expect(v2.requestedBy).toBe(w.ops.fullName);
    expect(v2.treatedBy).toBe(w.vendorUser.fullName);
    expect(v2.reason).toBe("Agent relocated");
    expect(v2.treatedAt).not.toBeNull();
    expect(detail.requests).toHaveLength(2);

    const remapAudit = await getDb().select().from(auditLogs).where(eq(auditLogs.entityId, t.id));
    expect(remapAudit.map((a) => a.action)).toContain("TERMINAL_REMAPPED");
  });

  it("serial number and TID cannot change during remapping", async () => {
    const { t } = await mappedTerminal();
    const base = { terminalId: t.id, agentName: "NEW AGENT", accountNumber: fakeAccount(), state: "Oyo", anmId: w.anm.id, reason: "test" };
    const e1 = await err(svc.createRemappingRequest(w.ops, { ...base, serialNumber: "DIFFERENT123" }));
    expect(e1.code).toBe("VALIDATION");
    expect(e1.message).toMatch(/Serial number cannot change/);
    const e2 = await err(svc.createRemappingRequest(w.ops, { ...base, tid: "ZZZZ0000" }));
    expect(e2.message).toMatch(/TID cannot change/);
    // Echoing the same identifiers is fine
    const ok = await svc.createRemappingRequest(w.ops, { ...base, serialNumber: t.serialNumber, tid: t.tid });
    expect(ok.status).toBe("READY_FOR_REVIEW");
    const e3 = await err(svc.updateRequest(w.ops, ok.id, { tid: "ZZZZ0000" }));
    expect(e3.message).toMatch(/cannot change during a remapping/);
  });

  it("rejects remapping an unmapped terminal and identical mappings", async () => {
    const input = mappingInput(w.anm.id);
    const r = await svc.createMappingRequest(w.ops, input);
    const e = await err(svc.createRemappingRequest(w.ops, { terminalId: r.terminalId, agentName: "X Y", accountNumber: fakeAccount(), state: "Oyo", anmId: w.anm.id, reason: "test" }));
    expect(e.code).toBe("CONFLICT");

    const { t, input: i2 } = await mappedTerminal();
    const e2 = await err(
      svc.createRemappingRequest(w.ops, { terminalId: t.id, agentName: "ABC ENTERPRISE", accountNumber: i2.accountNumber, state: "Lagos", area: "Ikeja", anmId: w.anm.id, reason: "no change" }),
    );
    expect(e2.message).toMatch(/identical/);
  });

  it("two users cannot create conflicting remappings at the same time", async () => {
    const { t } = await mappedTerminal();
    const mk = (actor: typeof w.ops, name: string) =>
      svc.createRemappingRequest(actor, { terminalId: t.id, agentName: name, accountNumber: fakeAccount(), state: "Kano", anmId: w.anm2.id, reason: "concurrency test" });
    const res = await Promise.allSettled([mk(w.ops, "USER A AGENT"), mk(w.admin, "USER B AGENT"), mk(w.field, "USER C AGENT")]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    for (const x of res.filter((x) => x.status === "rejected") as PromiseRejectedResult[]) {
      expect(x.reason.code).toBe("CONFLICT");
      expect(x.reason.message).toMatch(/pending remapping|open mapping\/remapping/);
    }
  });

  it("cancelling a remapping restores the terminal to MAPPED with its current mapping intact", async () => {
    const { t } = await mappedTerminal();
    const r = await svc.createRemappingRequest(w.ops, { terminalId: t.id, agentName: "TEMP AGENT", accountNumber: fakeAccount(), state: "Kano", anmId: w.anm2.id, reason: "test" });
    await svc.cancelRequest(w.ops, r.id, "changed mind");
    const [t2] = await getDb().select().from(terminals).where(eq(terminals.id, t.id));
    expect(t2.status).toBe("MAPPED");
    expect(t2.currentMappingId).toBe(t.currentMappingId);
  });

  it("supports multiple successive remappings (v1 → v2 → v3)", async () => {
    const { t } = await mappedTerminal();
    for (const name of ["SECOND AGENT", "THIRD AGENT"]) {
      const r = await svc.createRemappingRequest(w.ops, { terminalId: t.id, agentName: name, accountNumber: fakeAccount(), state: "Kano", anmId: w.anm2.id, reason: "rotation" });
      await svc.submitToVendor(w.ops, r.id, true);
      await svc.markTreated(w.vendorUser, r.id, true, null);
    }
    const versions = await getDb().select().from(terminalMappings).where(eq(terminalMappings.terminalId, t.id)).orderBy(terminalMappings.version);
    expect(versions.map((v) => [v.version, v.agentName, v.isCurrent])).toEqual([
      [1, "ABC ENTERPRISE", false],
      [2, "SECOND AGENT", false],
      [3, "THIRD AGENT", true],
    ]);
  });
});
