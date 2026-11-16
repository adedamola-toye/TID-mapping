import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, DUMMY_HASH } from "@/server/auth/password";
import { totpCode, verifyTotp, generateTotpSecret, base32Decode, base32Encode } from "@/server/auth/totp";
import { encrypt, decrypt, hmac } from "@/server/crypto";
import { sanitizeForAudit } from "@/server/audit";
import { safeCell } from "@/server/excel";
import { rateLimit, resetRateLimits } from "@/server/auth/rateLimit";

describe("password hashing", () => {
  it("hashes with scrypt and verifies", async () => {
    const h = await hashPassword("Correct#Horse2026");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("Correct#Horse2026", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });
  it("dummy hash never verifies", async () => {
    expect(await verifyPassword("", DUMMY_HASH)).toBe(false);
  });
  it("produces different hashes for the same password (salted)", async () => {
    expect(await hashPassword("Same#Password1")).not.toBe(await hashPassword("Same#Password1"));
  });
});

describe("field encryption", () => {
  it("round-trips and is non-deterministic", () => {
    const a = encrypt("0123456789");
    const b = encrypt("0123456789");
    expect(a).not.toBe(b);
    expect(a).not.toContain("0123456789");
    expect(decrypt(a)).toBe("0123456789");
  });
  it("detects tampering (GCM auth tag)", () => {
    const a = encrypt("0123456789");
    const parts = a.split(".");
    const ct = Buffer.from(parts[3], "base64");
    ct[0] ^= 1;
    parts[3] = ct.toString("base64");
    expect(() => decrypt(parts.join("."))).toThrow();
  });
  it("hmac is deterministic for exact-match search", () => {
    expect(hmac("0123456789")).toBe(hmac("0123456789"));
    expect(hmac("0123456789")).not.toBe(hmac("0123456788"));
  });
});

describe("TOTP", () => {
  it("matches RFC 6238 test vector", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, 59_000)).toBe("287082");
    expect(totpCode(secret, 1111111109_000)).toBe("081804");
  });
  it("verifies with ±1 step drift", () => {
    const s = generateTotpSecret();
    const now = Date.now();
    expect(verifyTotp(s, totpCode(s, now - 30_000), now)).toBe(true);
    expect(verifyTotp(s, totpCode(s, now - 120_000), now)).toBe(false);
    expect(verifyTotp(s, "abc", now)).toBe(false);
  });
  it("base32 round-trips", () => {
    const b = Buffer.from("wakeel");
    expect(base32Decode(base32Encode(b)).toString()).toBe("wakeel");
  });
});

describe("audit sanitisation", () => {
  it("removes secrets and masks account numbers", () => {
    const out = sanitizeForAudit({ passwordHash: "x", accountEnc: "y", token: "z", accountNumber: "0123456789", nested: { account: "9876543210" }, ok: 1 }) as Record<string, unknown>;
    expect(out).not.toHaveProperty("passwordHash");
    expect(out).not.toHaveProperty("accountEnc");
    expect(out).not.toHaveProperty("token");
    expect(out.accountNumber).toBe("******6789");
    expect((out.nested as Record<string, unknown>).account).toBe("******3210");
    expect(out.ok).toBe(1);
  });
});

describe("spreadsheet formula injection", () => {
  it("neutralises formula-leading cells on export", () => {
    expect(safeCell("=HYPERLINK(\"http://evil\")")).toBe("'=HYPERLINK(\"http://evil\")");
    expect(safeCell("+234")).toBe("'+234");
    expect(safeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(safeCell("NORMAL TEXT")).toBe("NORMAL TEXT");
    expect(safeCell(42)).toBe(42);
  });
});

describe("rate limiter", () => {
  it("blocks after the limit within the window", () => {
    resetRateLimits();
    for (let i = 0; i < 3; i++) expect(rateLimit("k", 3, 60_000).ok).toBe(true);
    expect(rateLimit("k", 3, 60_000).ok).toBe(false);
    expect(rateLimit("other", 3, 60_000).ok).toBe(true);
  });
});
