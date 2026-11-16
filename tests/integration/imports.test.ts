import { beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { eq } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { importRows, requests, terminals } from "@/server/db/schema";
import * as imp from "@/server/services/imports";
import * as svc from "@/server/services/requests";
import { AppError } from "@/server/errors";
import { decrypt } from "@/server/crypto";
import { world, newTerminalIds, fakeAccount, mappingInput } from "../fixtures";

let w: Awaited<ReturnType<typeof world>>;
beforeAll(async () => {
  w = await world();
});

async function xlsx(rows: (string | number)[][], opts: { titleRows?: string[] } = {}) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  for (const t of opts.titleRows ?? []) ws.addRow([t]);
  for (const r of rows) ws.addRow(r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function err(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as AppError;
  }
  throw new Error("expected error");
}

describe("vendor TID batch (legacy spreadsheet structure)", () => {
  it("imports the existing Location / Serial / Current TID / ISW TID / Status-Comment layout", async () => {
    const a = newTerminalIds();
    const b = newTerminalIds();
    const buf = await xlsx(
      [
        ["Location", "Terminal Serial Number", "Current TID", "ISW TID", "Status/Comment"],
        ["Rivers", Number(a.serialNumber.replace(/\D/g, "").padEnd(13, "1")), a.tid, "2ISAHQU1", "Done"],
        ["Lagos", b.serialNumber, b.tid, "", "Having EOD Issues"],
      ],
      { titleRows: ["ELNEXU TID ALLOCATION — NOVEMBER"] },
    );
    const up = await imp.uploadBatch(w.ops, "TERMINAL_STOCK", "elnexu batch.xlsx", buf);
    expect(up.headers).toEqual(["Location", "Terminal Serial Number", "Current TID", "ISW TID", "Status/Comment"]);
    expect(up.mapping).toMatchObject({ serialNumber: "Terminal Serial Number", tid: "Current TID", iswTid: "ISW TID", location: "Location", comment: "Status/Comment" });
    const v = await imp.validateBatch(w.ops, up.batchId);
    expect(v.counts).toEqual({ VALID: 2, ERROR: 0, DUPLICATE: 0 });
    const c = await imp.commitBatch(w.ops, up.batchId);
    expect(c.imported).toBe(2);
    const [tb] = await getDb().select().from(terminals).where(eq(terminals.serialNumber, b.serialNumber));
    expect(tb).toMatchObject({ tid: b.tid, stockLocation: "Lagos", legacyComment: "Having EOD Issues", status: "AVAILABLE" });
    const [ta] = await getDb().select().from(terminals).where(eq(terminals.tid, a.tid));
    expect(ta.legacyStatus).toBe("Done");
    expect(ta.iswTid).toBe("2ISAHQU1");
    // Re-uploading the same file flags duplicates rather than importing twice
    const up2 = await imp.uploadBatch(w.ops, "TERMINAL_STOCK", "elnexu batch again.xlsx", buf);
    const v2 = await imp.validateBatch(w.ops, up2.batchId);
    expect(v2.counts.DUPLICATE).toBe(2);
  });
});

describe("mapping batch upload", () => {
  it("validates every row, reports duplicates & missing info, allows correction, imports only valid rows", async () => {
    const ok1 = newTerminalIds();
    const ok2 = newTerminalIds();
    const dup = ok1;
    const pending = mappingInput(w.anm.id);
    await svc.createMappingRequest(w.ops, pending); // already has a pending request
    const csv = [
      "Terminal Serial Number,TID,Agent Name,Account Number,State,ANM,Comment",
      `${ok1.serialNumber},${ok1.tid},GOOD AGENT ONE,${fakeAccount()},Lagos,${w.anm.code},`,
      `${ok2.serialNumber},${ok2.tid},GOOD AGENT TWO,${fakeAccount()},abuja,${w.anm.fullName},`,
      `${dup.serialNumber},${dup.tid},DUP AGENT,${fakeAccount()},Lagos,${w.anm.code},`,
      `${pending.serialNumber},${pending.tid},PENDING AGENT,${fakeAccount()},Lagos,${w.anm.code},`,
      `NEWSERIAL0001,BADTID,,123,Atlantis,John Doe,`,
      `NEWSERIAL0002,ZZ990001,INACTIVE ANM AGENT,${fakeAccount()},Kano,${w.inactiveAnm.code},`,
    ].join("\n");
    const up = await imp.uploadBatch(w.ops, "MAPPING", "mapping-batch.csv", Buffer.from(csv));
    expect(up.totalRows).toBe(6);
    const v = await imp.validateBatch(w.ops, up.batchId);
    expect(v.counts).toEqual({ VALID: 2, ERROR: 2, DUPLICATE: 2 });

    const detail = await imp.getBatch(w.ops, up.batchId, { pageSize: 50 });
    const bad = detail.rows.find((r) => r.raw["Terminal Serial Number"] === "NEWSERIAL0001")!;
    expect(Object.keys(bad.errors)).toEqual(expect.arrayContaining(["tid", "agentName", "accountNumber", "location", "anm"]));
    expect(bad.errors.anm).toMatch(/approved ANM list/);
    const inactive = detail.rows.find((r) => r.raw["Terminal Serial Number"] === "NEWSERIAL0002")!;
    expect(inactive.errors.anm).toMatch(/inactive/);
    // Account numbers are masked in normalised output, encrypted at rest
    const good = detail.rows.find((r) => r.status === "VALID")!;
    expect(String(good.normalized.account)).toMatch(/^••••••/);
    expect(good.normalized).not.toHaveProperty("accountEnc");
    const [rawRow] = await getDb().select().from(importRows).where(eq(importRows.id, good.id));
    expect(rawRow.rawEnc).not.toContain("GOOD AGENT");
    expect(JSON.parse(decrypt(rawRow.rawEnc))["Agent Name"]).toMatch(/GOOD AGENT/);

    // Correct the broken row in the browser
    const fixed = await imp.correctRow(w.ops, up.batchId, bad.id, {
      TID: "ZZ990002",
      "Agent Name": "FIXED AGENT",
      "Account Number": fakeAccount(),
      State: "Rivers",
      ANM: w.anm.code,
    });
    expect(fixed.counts.VALID).toBe(3);

    // Failed rows can be downloaded for offline correction
    const f = await imp.exportFailedRows(w.ops, up.batchId);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(f.buffer as unknown as ArrayBuffer);
    expect(wb.worksheets[0].rowCount).toBe(1 + 3);

    const c = await imp.commitBatch(w.ops, up.batchId);
    expect(c.imported).toBe(3);
    const created = await getDb().select().from(requests).where(eq(requests.batchId, up.batchId));
    expect(created).toHaveLength(3);
    expect(created.every((r) => r.status === "READY_FOR_REVIEW")).toBe(true);
    expect(created.find((r) => r.agentName === "GOOD AGENT TWO")?.state).toBe("FCT");

    // Batch review → bulk submit
    const sub = await svc.bulkSubmitToVendor(w.ops, created.map((r) => r.id), true);
    expect(sub.succeeded).toHaveLength(3);
    // Cannot import twice
    expect((await err(imp.commitBatch(w.ops, up.batchId))).code).toBe("INVALID_STATE");
  });

  it("refuses to validate when required columns are missing", async () => {
    const up = await imp.uploadBatch(w.ops, "MAPPING", "partial.csv", Buffer.from("Serial Number,TID\nABC123456,ABCD1234\n"));
    const e = await err(imp.validateBatch(w.ops, up.batchId));
    expect(e.message).toMatch(/Map the required columns/);
    expect(e.message).toMatch(/Account Number/);
  });

  it("supports manual column mapping for non-standard headers", async () => {
    const ids = newTerminalIds();
    const csv = `Machine,Term,Shop,Acct,Where,Manager\n${ids.serialNumber},${ids.tid},MAPPED COLUMNS LTD,${fakeAccount()},Oyo,${w.anm.code}\n`;
    const up = await imp.uploadBatch(w.ops, "MAPPING", "odd-headers.csv", Buffer.from(csv));
    expect(up.mapping.serialNumber).toBeNull();
    const v = await imp.validateBatch(w.ops, up.batchId, {
      serialNumber: "Machine",
      tid: "Term",
      agentName: "Shop",
      accountNumber: "Acct",
      location: "Where",
      anm: "Manager",
    });
    expect(v.counts.VALID).toBe(1);
  });

  it("rejects non-spreadsheet and spoofed files", async () => {
    expect((await err(imp.uploadBatch(w.ops, "MAPPING", "evil.exe", Buffer.from("MZ")))).code).toBe("BAD_REQUEST");
    expect((await err(imp.uploadBatch(w.ops, "MAPPING", "fake.xlsx", Buffer.from("<html>not excel</html>")))).message).toMatch(/not a valid Excel/);
    expect((await err(imp.uploadBatch(w.ops, "MAPPING", "../../etc/passwd.csv", Buffer.from("a,b\n1,2")))).code).toBe("BAD_REQUEST");
    expect((await err(imp.uploadBatch(w.ops, "MAPPING", "empty.csv", Buffer.from("Serial,TID\n")))).message).toMatch(/no data rows/);
  });

  it("only authorised roles can import", async () => {
    expect((await err(imp.uploadBatch(w.field, "MAPPING", "x.csv", Buffer.from("a\n1")))).code).toBe("FORBIDDEN");
    expect((await err(imp.uploadBatch(w.vendorUser, "MAPPING", "x.csv", Buffer.from("a\n1")))).code).toBe("FORBIDDEN");
  });

  it("handles a large batch (2,000 rows) within reasonable time", async () => {
    const lines = ["Terminal Serial Number,Current TID,ISW TID,Location"];
    const seed = Math.floor(Math.random() * 1e5);
    for (let i = 0; i < 2000; i++) lines.push(`BIG${seed}${String(i).padStart(5, "0")},B${String(seed).slice(0, 2).padStart(2, "0")}${String(i).padStart(5, "0")},,Lagos`);
    const t0 = Date.now();
    const up = await imp.uploadBatch(w.ops, "TERMINAL_STOCK", "big.csv", Buffer.from(lines.join("\n")));
    const v = await imp.validateBatch(w.ops, up.batchId);
    expect(v.counts.VALID).toBe(2000);
    const c = await imp.commitBatch(w.ops, up.batchId);
    expect(c.imported).toBe(2000);
    expect(Date.now() - t0).toBeLessThan(60_000);
  }, 120_000);
});

describe("remapping batch", () => {
  it("validates terminal identity and imports remapping requests", async () => {
    const m = mappingInput(w.anm.id);
    const r = await svc.createMappingRequest(w.ops, m);
    await svc.submitToVendor(w.ops, r.id, true);
    await svc.markTreated(w.vendorUser, r.id, true, null);
    const csv = [
      "TID,New Agent Name,New Account Number,State,ANM,Reason",
      `${m.tid},REMAPPED VIA BATCH,${fakeAccount()},Ogun,${w.anm2.code},Relocated`,
      `ZZZZ9999,UNKNOWN TERMINAL,${fakeAccount()},Ogun,${w.anm2.code},Relocated`,
    ].join("\n");
    const up = await imp.uploadBatch(w.ops, "REMAPPING", "remap.csv", Buffer.from(csv));
    const v = await imp.validateBatch(w.ops, up.batchId);
    expect(v.counts).toMatchObject({ VALID: 1, ERROR: 1 });
    const c = await imp.commitBatch(w.ops, up.batchId);
    expect(c.imported).toBe(1);
    const [req] = await getDb().select().from(requests).where(eq(requests.batchId, up.batchId));
    expect(req).toMatchObject({ type: "REMAPPING", serialNumber: m.serialNumber, tid: m.tid, agentName: "REMAPPED VIA BATCH" });
  });
});
