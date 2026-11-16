import { NextResponse } from "next/server";
import { publicApi, readJson, setSessionCookies, homeFor } from "@/server/http";
import { login, getSession } from "@/server/auth/service";
import { rateLimit } from "@/server/auth/rateLimit";
import { AppError } from "@/server/errors";

export const POST = publicApi(async ({ req, meta }) => {
  const body = await readJson<{ email?: string; password?: string }>(req, 4096);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) throw new AppError("VALIDATION", "Enter your email and password.");
  if (password.length > 256) throw new AppError("UNAUTHENTICATED", "Invalid email or password.");
  // Throttle per IP and per account (in addition to the persistent account lockout).
  const ipLimit = rateLimit(`login-ip:${meta.ip ?? "unknown"}`, 30, 10 * 60_000);
  const userLimit = rateLimit(`login-user:${email}`, 10, 10 * 60_000);
  if (!ipLimit.ok || !userLimit.ok) {
    throw new AppError("RATE_LIMITED", `Too many sign-in attempts. Try again in ${Math.max(ipLimit.retryAfterSec, userLimit.retryAfterSec)} seconds.`);
  }
  const result = await login(email, password, meta);
  const session = await getSession(result.token, { allowMfaPending: true });
  const res = NextResponse.json({
    ok: true,
    mfaRequired: result.mfaRequired,
    mustChangePassword: result.mustChangePassword,
    redirectTo: result.mfaRequired
      ? "/login/mfa"
      : result.mustChangePassword
        ? "/account/password?required=1"
        : homeFor(session?.user.role ?? ""),
  });
  setSessionCookies(res, result.token, result.csrfToken);
  return res;
});
