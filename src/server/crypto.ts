import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config";

/** AES-256-GCM field encryption. Format: v1.<iv b64>.<tag b64>.<ciphertext b64> */
export function encrypt(plain: string): string {
  const key = Buffer.from(config().DATA_ENCRYPTION_KEY, "base64");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64")}.${tag.toString("base64")}.${ct.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [v, ivB, tagB, ctB] = payload.split(".");
  if (v !== "v1" || !ivB || !tagB || ctB === undefined) throw new Error("Unsupported ciphertext format");
  const key = Buffer.from(config().DATA_ENCRYPTION_KEY, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64"));
  decipher.setAuthTag(Buffer.from(tagB, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ctB, "base64")), decipher.final()]).toString("utf8");
}

/** Keyed hash for exact-match search & duplicate detection without storing plaintext. */
export function hmac(value: string): string {
  return createHmac("sha256", Buffer.from(config().DATA_HASH_KEY, "base64")).update(value).digest("hex");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Protected account-number bundle stored on rows. */
export function protectAccount(acct: string) {
  return { accountEnc: encrypt(acct), accountHash: hmac(acct), accountLast4: acct.slice(-4) };
}
