import { describe, expect, it } from "vitest";
import {
  accountNumberProblem,
  isValidSerial,
  isValidTid,
  mappingInputSchema,
  normalizeIdentifier,
  nubanCheckDigitValid,
  passwordPolicy,
  remappingInputSchema,
  exceptionInputSchema,
} from "@/lib/validation";
import { normalizeState } from "@/lib/constants";
import { maskAccount } from "@/lib/format";

describe("identifier validation", () => {
  it("normalises identifiers to upper-case without spaces", () => {
    expect(normalizeIdentifier(" 2isa hqu1 ")).toBe("2ISAHQU1");
    expect(normalizeIdentifier(1662426143827)).toBe("1662426143827");
  });
  it("validates TIDs (8 alphanumerics)", () => {
    expect(isValidTid("2ISAHQU1")).toBe(true);
    expect(isValidTid("2WKL1136")).toBe(true);
    expect(isValidTid("2WKL113")).toBe(false);
    expect(isValidTid("2WKL-136")).toBe(false);
  });
  it("validates serial numbers", () => {
    expect(isValidSerial("1662426143827")).toBe(true);
    expect(isValidSerial("ABC")).toBe(false);
    expect(isValidSerial("<script>")).toBe(false);
  });
});

describe("account numbers", () => {
  it("requires exactly 10 digits", () => {
    expect(accountNumberProblem("")).toMatch(/required/);
    expect(accountNumberProblem("12345")).toMatch(/10 digits/);
    expect(accountNumberProblem("12345678901")).toMatch(/10 digits/);
    expect(accountNumberProblem("12345abcde")).toMatch(/10 digits/);
    expect(accountNumberProblem("0123456789")).toBeNull();
  });
  it("rejects obviously invalid repeated digits", () => {
    expect(accountNumberProblem("0000000000")).toMatch(/same digit/);
    expect(accountNumberProblem("1111111111")).toMatch(/same digit/);
  });
  it("implements the CBN NUBAN check digit", () => {
    // Build a valid account for bank code 058 and serial 000001234
    const serial = "000001234";
    const digits = ("000058" + serial).split("").map(Number);
    const w = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];
    const check = (10 - (digits.reduce((a, d, i) => a + d * w[i], 0) % 10)) % 10;
    const acct = serial + check;
    expect(nubanCheckDigitValid(acct, "058")).toBe(true);
    expect(nubanCheckDigitValid(acct, "000058")).toBe(true);
    const wrong = serial + ((check + 1) % 10);
    expect(nubanCheckDigitValid(wrong, "058")).toBe(false);
  });
  it("masks account numbers for display", () => {
    expect(maskAccount("6789")).toBe("••••••6789");
    expect(maskAccount(null)).toBe("—");
  });
});

describe("mapping input schema", () => {
  const anmId = "8a7c1f8e-1111-4c3a-9e3b-0d0b0c0a0e01";
  const base = { serialNumber: "1662426143827", tid: "2isahqu1", agentName: "tanta dynamic enterprise", accountNumber: "0123456789", state: "Rivers", anmId };
  it("accepts and normalises a valid request", () => {
    const r = mappingInputSchema.parse(base);
    expect(r.tid).toBe("2ISAHQU1");
    expect(r.agentName).toBe("TANTA DYNAMIC ENTERPRISE");
    expect(r.priority).toBe("NORMAL");
  });
  it("reports every missing required field", () => {
    const r = mappingInputSchema.safeParse({ serialNumber: "", tid: "", agentName: "", accountNumber: "", state: "", anmId: "" });
    expect(r.success).toBe(false);
    const paths = r.error!.issues.map((i) => i.path[0]);
    for (const f of ["serialNumber", "tid", "agentName", "accountNumber", "state", "anmId"]) expect(paths).toContain(f);
  });
  it("does not accept free-text ANM or unknown states", () => {
    expect(mappingInputSchema.safeParse({ ...base, anmId: "John Doe" }).success).toBe(false);
    expect(mappingInputSchema.safeParse({ ...base, state: "Atlantis" }).success).toBe(false);
  });
  it("rejects script/markup in agent names", () => {
    expect(mappingInputSchema.safeParse({ ...base, agentName: "<script>alert(1)</script>" }).success).toBe(false);
  });
  it("remapping schema has no serial/TID fields", () => {
    expect(Object.keys(remappingInputSchema.shape)).not.toContain("serialNumber");
    expect(Object.keys(remappingInputSchema.shape)).not.toContain("tid");
  });
  it("exception 'Other' requires a description", () => {
    expect(exceptionInputSchema.safeParse({ reason: "OTHER" }).success).toBe(false);
    expect(exceptionInputSchema.safeParse({ reason: "OTHER", comment: "Printer jammed" }).success).toBe(true);
    expect(exceptionInputSchema.safeParse({ reason: "MADE_UP" }).success).toBe(false);
  });
});

describe("locations", () => {
  it("maps legacy spreadsheet locations to controlled states", () => {
    expect(normalizeState("Rivers")).toBe("Rivers");
    expect(normalizeState("rivers state")).toBe("Rivers");
    expect(normalizeState("Abuja")).toBe("FCT");
    expect(normalizeState("Port Harcourt")).toBe("Rivers");
    expect(normalizeState("Nowhere")).toBeNull();
  });
});

describe("password policy", () => {
  it("enforces length and complexity", () => {
    expect(passwordPolicy.safeParse("short1!").success).toBe(false);
    expect(passwordPolicy.safeParse("alllowercaseletters").success).toBe(false);
    expect(passwordPolicy.safeParse("Good#Password2026").success).toBe(true);
  });
});
