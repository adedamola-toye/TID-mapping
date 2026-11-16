import { NextResponse } from "next/server";
import { publicApi, readJson, setSessionCookies, homeFor } from "@/server/http";
import { login, getSession } from "@/server/auth/service";
import { isLimited, recordFailure } from "@/server/auth/rateLimit";
import { AppError } from "@/server/errors";

export const POST = publicApi(async ({ req, meta }) => {
  const body = await readJson<{ email?: string; password?: string }>(req, 4096);
  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  if (!email || !password) throw new AppError("VALIDATION", "Enter your email and password.");
  if (password.length > 256) throw new AppError("UNAUTHENTICATED", "Invalid email or password.");
  // Throttle repeated FAILURES per account and per client IP (successful sign-ins are not counted),
  // in addition to the persistent account lockout.
  const WINDOW = 10 * 60_000;
  // Without a trusted client IP (TRUST_PROXY=false) an IP bucket would be shared by every user,
  // so only the per-account limit applies in that case.
  const ipKey = meta.ip ? `login-ip:${meta.ip}` : null;
  const userKey = `login-user:${email}`;
  const ip = ipKey ? isLimited(ipKey, 50) : { limited: false, retryAfterSec: 0 };
  const user = isLimited(userKey, 10);
  if (ip.limited || user.limited) {
    throw new AppError("RATE_LIMITED", `Too many failed sign-in attempts. Try again in ${Math.max(ip.retryAfterSec, user.retryAfterSec)} seconds.`);
  }
  let result: Awaited<ReturnType<typeof login>>;
  try {
    result = await login(email, password, meta);
  } catch (e) {
    if (e instanceof AppError && (e.code === "UNAUTHENTICATED" || e.code === "LOCKED")) {
      if (ipKey) recordFailure(ipKey, WINDOW);
      recordFailure(userKey, WINDOW);
    }
    throw e;
  }
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
