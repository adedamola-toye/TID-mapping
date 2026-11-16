import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { auditLogs } from "@/server/db/schema";
import { getRegionMap, updateRegionMap } from "@/server/services/regions";
import * as svc from "@/server/services/requests";
import { locationReport } from "@/server/services/reports";
import { searchTerminals } from "@/server/services/terminals";
import { AppError } from "@/server/errors";
import { DEFAULT_NORTH_BANK, NIGERIAN_STATES } from "@/lib/constants";
import { world, mappingInput } from "../fixtures";

let w: Awaited<ReturnType<typeof world>>;
beforeAll(async () => {
  w = await world();
});

describe("North Bank / South Bank regions", () => {
  it("every state starts in a bank (migration defaults)", async () => {
    const map = await getRegionMap();
    expect(Object.keys(map).sort()).toEqual([...NIGERIAN_STATES].sort());
    for (const s of DEFAULT_NORTH_BANK) expect(map[s]).toBe("NORTH_BANK");
    expect(map.Lagos).toBe("SOUTH_BANK");
    expect(map.Rivers).toBe("SOUTH_BANK");
  });

  it("only Super Admins can reassign states; changes are audited", async () => {
    await expect(updateRegionMap(w.ops, { assignments: { Kwara: "SOUTH_BANK" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateRegionMap(w.vendorUser, { assignments: { Kwara: "SOUTH_BANK" } })).rejects.toBeInstanceOf(AppError);
    await expect(updateRegionMap(w.admin, { assignments: { Atlantis: "SOUTH_BANK" } })).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(updateRegionMap(w.admin, { assignments: { Kwara: "MIDDLE_BANK" } })).rejects.toMatchObject({ code: "VALIDATION" });
    const map = await updateRegionMap(w.admin, { assignments: { Kwara: "SOUTH_BANK" } });
    expect(map.Kwara).toBe("SOUTH_BANK");
    const [a] = await getDb()
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.action, "REGIONS_UPDATED"), eq(auditLogs.actorId, w.admin.id)));
    expect(a.oldValue).toEqual({ Kwara: "North Bank" });
    expect(a.newValue).toEqual({ Kwara: "South Bank" });
    await updateRegionMap(w.admin, { assignments: { Kwara: "NORTH_BANK" } });
  });

  it("bank filters follow the live assignment for requests, terminals and reports", async () => {
    const r = await svc.createMappingRequest(w.ops, mappingInput(w.anm.id, { state: "Kogi" }));
    await svc.submitToVendor(w.ops, r.id, true);
    await svc.markTreated(w.vendorUser, r.id, true, null);

    const inNorth = await svc.searchRequests(w.ops, { region: "NORTH_BANK", q: r.serialNumber });
    const inSouth = await svc.searchRequests(w.ops, { region: "SOUTH_BANK", q: r.serialNumber });
    expect(inNorth.total).toBe(1);
    expect(inSouth.total).toBe(0);
    expect((await searchTerminals(w.ops, { region: "NORTH_BANK", q: r.serialNumber })).total).toBe(1);

    // Admin moves Kogi to the South Bank → existing records follow immediately
    await updateRegionMap(w.admin, { assignments: { Kogi: "SOUTH_BANK" } });
    expect((await svc.searchRequests(w.ops, { region: "SOUTH_BANK", q: r.serialNumber })).total).toBe(1);
    expect((await searchTerminals(w.ops, { region: "SOUTH_BANK", q: r.serialNumber })).total).toBe(1);
    const rep = await locationReport(w.ops, { region: "SOUTH_BANK" });
    expect(rep.rows.find((x) => x.state === "Kogi")?.terminals).toBeGreaterThan(0);
    expect(rep.rows.every((x) => x.region === "SOUTH_BANK")).toBe(true);
    expect(rep.banks.map((b) => b.label)).toEqual(["South Bank"]);

    // A state can be left unassigned
    const map = await updateRegionMap(w.admin, { assignments: { Kogi: null } });
    expect(map.Kogi).toBeNull();
    expect((await svc.searchRequests(w.ops, { region: "NORTH_BANK", q: r.serialNumber })).total).toBe(0);
    const all = await locationReport(w.ops, {});
    expect(all.banks.some((b) => b.label === "Unassigned")).toBe(true);
    await updateRegionMap(w.admin, { assignments: { Kogi: "NORTH_BANK" } });
  });
});
