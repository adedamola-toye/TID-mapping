import { NextResponse } from "next/server";
import { publicApi, readJson, SESSION_COOKIE, homeFor, CSRF_COOKIE } from "@/server/http";
import { getSession, verifyMfa } from "@/server/auth/service";
import { rateLimit } from "@/server/auth/rateLimit";
import { AppError } from "@/server/errors";
import { safeEqual } from "@/server/crypto";

/** Second step of sign-in for MFA-enabled accounts. */
export const POST = publicApi(async ({ req, meta }) => {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const pending = await getSession(token, { allowMfaPending: true });
  if (!pending || !token) throw new AppError("UNAUTHENTICATED", "Your sign-in has expired. Please sign in again.");
  const csrf = req.headers.get("x-csrf-token") ?? "";
  if (!csrf || !safeEqual(csrf, req.cookies.get(CSRF_COOKIE)?.value ?? "") || !safeEqual(csrf, pending.csrfToken)) {
    throw new AppError("FORBIDDEN", "Security token missing or invalid.");
  }
  const rl = rateLimit(`mfa:${pending.user.id}`, 5, 5 * 60_000);
  if (!rl.ok) throw new AppError("RATE_LIMITED", "Too many attempts. Sign in again.");
  const body = await readJson<{ code?: string }>(req, 1024);
  await verifyMfa(token, String(body.code ?? "").trim(), meta);
  return NextResponse.json({ ok: true, redirectTo: pending.user.mustChangePassword ? "/account/password?required=1" : homeFor(pending.user.role) });
});
