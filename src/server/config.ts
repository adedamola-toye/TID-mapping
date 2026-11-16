import "server-only";
import { z } from "zod";
import { DEFAULT_TID_PATTERN } from "@/lib/validation";

const bool = z
  .string()
  .optional()
  .transform((v) => v === "true" || v === "1");

const key32 = z
  .string({ message: "is required" })
  .refine((v) => Buffer.from(v, "base64").length === 32, "must be 32 bytes, base64 encoded");

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "is required"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATA_ENCRYPTION_KEY: key32,
  DATA_HASH_KEY: key32,
  SESSION_IDLE_TIMEOUT_MINUTES: z.coerce.number().int().min(5).max(240).default(30),
  SESSION_ABSOLUTE_TIMEOUT_MINUTES: z.coerce.number().int().min(30).max(1440).default(720),
  MAX_FAILED_LOGINS: z.coerce.number().int().min(3).max(20).default(5),
  LOCKOUT_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  SECURE_COOKIES: bool,
  NUBAN_BANK_CODE: z
    .string()
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null))
    .refine((v) => v === null || /^(\d{3}|\d{6})$/.test(v), "must be 3 or 6 digits"),
  TID_PATTERN: z.string().optional().transform((v) => (v && v.trim() ? v.trim() : DEFAULT_TID_PATTERN)),
  EMAIL_TRANSPORT: z.enum(["none", "console"]).default("none"),
  IMPORT_MAX_BYTES: z.coerce.number().int().min(10_000).max(50_000_000).default(5_242_880),
  IMPORT_MAX_ROWS: z.coerce.number().int().min(10).max(100_000).default(10_000),
  TRUST_PROXY: bool,
});

export type AppConfig = z.infer<typeof schema>;

let cached: AppConfig | null = null;

export function config(): AppConfig {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const c = parsed.data;
  if (c.NODE_ENV === "production") {
    // Plain-HTTP cookies are only tolerated for a production build served on localhost (CI / e2e).
    const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(c.APP_URL);
    if (!c.SECURE_COOKIES && !local) throw new Error("SECURE_COOKIES must be true in production.");
    if (c.EMAIL_TRANSPORT === "console")
      throw new Error("EMAIL_TRANSPORT=console is not allowed in production (would log reset links).");
  }
  cached = c;
  return c;
}
