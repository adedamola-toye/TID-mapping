import { publicApi, readJson } from "@/server/http";
import { completePasswordReset } from "@/server/auth/service";
import { rateLimit } from "@/server/auth/rateLimit";
import { AppError } from "@/server/errors";

export const POST = publicApi(async ({ req, meta }) => {
  const rl = rateLimit(`reset:${meta.ip ?? "unknown"}`, 10, 15 * 60_000);
  if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many attempts. Please try again later.");
  const body = await readJson<{ token?: string; password?: string }>(req, 4096);
  await completePasswordReset(String(body.token ?? ""), String(body.password ?? ""), meta);
  return { ok: true };
});
