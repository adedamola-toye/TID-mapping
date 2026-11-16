/**
 * Shared validation rules (client + server). The server ALWAYS re-validates — client checks are
 * only for fast feedback. Server-only rules (NUBAN check digit, uniqueness) live in the services.
 */
import { z } from "zod";
import { EXCEPTION_REASONS, NIGERIAN_STATES, PRIORITIES } from "./constants";

export const DEFAULT_TID_PATTERN = "^[A-Z0-9]{8}$";
const SERIAL_PATTERN = /^[A-Z0-9][A-Z0-9\-/]{4,39}$/;
const NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N} .,&'()\-\/]*$/u;

/** Uppercase + strip whitespace. Excel often turns long serials into numbers; callers pass strings. */
export function normalizeIdentifier(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, "").toUpperCase();
}

export function normalizeName(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/\s+/g, " ").trim().toUpperCase();
}

export function normalizeAccount(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[\s-]/g, "");
}

export function isValidSerial(serial: string): boolean {
  return SERIAL_PATTERN.test(serial);
}

export function isValidTid(tid: string, pattern: string = DEFAULT_TID_PATTERN): boolean {
  return new RegExp(pattern).test(tid);
}

/** Structural account-number checks (10-digit NUBAN, no obviously fake values). */
export function accountNumberProblem(acct: string): string | null {
  if (!acct) return "Account number is required.";
  if (!/^\d{10}$/.test(acct)) return "Account number must be exactly 10 digits (NUBAN).";
  if (/^(\d)\1{9}$/.test(acct)) return "Account number cannot be the same digit repeated.";
  return null;
}

/**
 * CBN NUBAN check-digit validation. Bank code may be 3-digit (legacy, padded with "000") or 6-digit.
 * Weights 3,7,3,3,7,3,... applied to bankCode(6) + serial(9); check = (10 - sum % 10) % 10.
 */
export function nubanCheckDigitValid(acct: string, bankCode: string): boolean {
  if (!/^\d{10}$/.test(acct)) return false;
  const code = bankCode.length === 3 ? `000${bankCode}` : bankCode;
  if (!/^\d{6}$/.test(code)) return false;
  const digits = (code + acct.slice(0, 9)).split("").map(Number);
  const weights = [3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3, 3, 7, 3];
  const sum = digits.reduce((acc, d, i) => acc + d * weights[i], 0);
  const check = (10 - (sum % 10)) % 10;
  return check === Number(acct[9]);
}

export const serialSchema = z
  .string()
  .transform(normalizeIdentifier)
  .refine((s) => s.length > 0, "Terminal serial number is required.")
  .refine(isValidSerial, "Serial number must be 5–40 letters/digits (dashes allowed).");

export const tidSchema = z
  .string()
  .transform(normalizeIdentifier)
  .refine((s) => s.length > 0, "TID is required.")
  .refine((s) => isValidTid(s), "TID must be 8 letters/digits (e.g. 2WKL1136).");

export const optionalTidSchema = z
  .string()
  .optional()
  .nullable()
  .transform((v) => (v ? normalizeIdentifier(v) : null))
  .refine((s) => s === null || isValidTid(s), "ISW TID must be 8 letters/digits.");

export const agentNameSchema = z
  .string()
  .transform(normalizeName)
  .refine((s) => s.length >= 2, "Agent/merchant name is required (at least 2 characters).")
  .refine((s) => s.length <= 150, "Agent/merchant name is too long (max 150 characters).")
  .refine((s) => NAME_PATTERN.test(s), "Agent/merchant name contains invalid characters.");

export const accountNumberSchema = z
  .string()
  .transform(normalizeAccount)
  .superRefine((s, ctx) => {
    const p = accountNumberProblem(s);
    if (p) ctx.addIssue({ code: "custom", message: p });
  });

export const stateSchema = z.enum(NIGERIAN_STATES, { message: "Select a valid state/location." });

export const areaSchema = z
  .string()
  .max(120, "Area/LGA is too long.")
  .optional()
  .nullable()
  .transform((v) => (v ? v.replace(/\s+/g, " ").trim() : null));

export const commentSchema = z
  .string()
  .max(1000, "Comment is too long (max 1000 characters).")
  .optional()
  .nullable()
  .transform((v) => (v ? v.trim() : null));

export const uuidSchema = z.string().uuid("Invalid identifier.");

/** Mapping (new) request capture. */
export const mappingInputSchema = z.object({
  serialNumber: serialSchema,
  tid: tidSchema,
  iswTid: optionalTidSchema,
  agentName: agentNameSchema,
  accountNumber: accountNumberSchema,
  state: stateSchema,
  area: areaSchema,
  anmId: uuidSchema.describe("ANM"),
  priority: z.enum(PRIORITIES).default("NORMAL"),
  internalComment: commentSchema,
});
export type MappingInput = z.input<typeof mappingInputSchema>;

/** Remapping: only agent/account/location/ANM can change. Terminal is referenced by id. */
export const remappingInputSchema = z.object({
  terminalId: uuidSchema,
  agentName: agentNameSchema,
  accountNumber: accountNumberSchema,
  state: stateSchema,
  area: areaSchema,
  anmId: uuidSchema,
  priority: z.enum(PRIORITIES).default("NORMAL"),
  reason: z
    .string()
    .transform((v) => v.trim())
    .refine((v) => v.length >= 3, "Please give a reason for the remapping.")
    .refine((v) => v.length <= 500, "Reason is too long."),
  internalComment: commentSchema,
});
export type RemappingInput = z.input<typeof remappingInputSchema>;

export const exceptionInputSchema = z.object({
  reason: z.enum(EXCEPTION_REASONS, { message: "Select an exception reason." }),
  comment: commentSchema,
}).superRefine((v, ctx) => {
  if (v.reason === "OTHER" && !v.comment) {
    ctx.addIssue({ code: "custom", path: ["comment"], message: "Please describe the problem." });
  }
});

export const passwordPolicy = z
  .string()
  .min(12, "Password must be at least 12 characters.")
  .max(128, "Password is too long.")
  .refine((p) => {
    let classes = 0;
    if (/[a-z]/.test(p)) classes++;
    if (/[A-Z]/.test(p)) classes++;
    if (/\d/.test(p)) classes++;
    if (/[^A-Za-z0-9]/.test(p)) classes++;
    return classes >= 3;
  }, "Use at least three of: lowercase, uppercase, digits, symbols.");

/** Flatten a ZodError into { field: message }. */
export function fieldErrors(err: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
