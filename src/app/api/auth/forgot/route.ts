import { publicApi, readJson } from "@/server/http";
import { requestPasswordReset } from "@/server/auth/service";
import { rateLimit } from "@/server/auth/rateLimit";
import { AppError } from "@/server/errors";

export const POST = publicApi(async ({ req, meta }) => {
  const body = await readJson<{ email?: string }>(req, 2048);
  const email = String(body.email ?? "").trim().toLowerCase();
  const rl = rateLimit(`forgot:${meta.ip ?? "unknown"}:${email}`, 3, 15 * 60_000);
  if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many requests. Please try again later.");
  if (email) await requestPasswordReset(email, meta);
  // Identical response whether or not the account exists (no enumeration).
  return { ok: true, message: "If an account exists for that email, a reset link has been sent." };
});
