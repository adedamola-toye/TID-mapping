import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { AppError, fromDbError } from "./errors";
import { config } from "./config";
import { getSession, type ActiveSession, type RequestMeta } from "./auth/service";
import { can, type Permission } from "./rbac";
import { safeEqual } from "./crypto";
import type { Actor } from "./actor";

export const SESSION_COOKIE = "wk_session";
export const CSRF_COOKIE = "wk_csrf";

export function requestMeta(h: Headers): RequestMeta {
  let ip: string | null = null;
  if (config().TRUST_PROXY) {
    ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  }
  return { ip: ip ? ip.slice(0, 64) : null, userAgent: h.get("user-agent")?.slice(0, 300) ?? null };
}

export function actorFrom(s: ActiveSession, meta: RequestMeta): Actor {
  return {
    id: s.user.id,
    email: s.user.email,
    fullName: s.user.fullName,
    role: s.user.role,
    vendorId: s.user.vendorId,
    ip: meta.ip,
    userAgent: meta.userAgent,
  };
}

export function setSessionCookies(res: NextResponse, token: string, csrf: string) {
  const secure = config().SECURE_COOKIES;
  const maxAge = config().SESSION_ABSOLUTE_TIMEOUT_MINUTES * 60;
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge });
  res.cookies.set(CSRF_COOKIE, csrf, { httpOnly: false, secure, sameSite: "strict", path: "/", maxAge });
}

export function clearSessionCookies(res: NextResponse) {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
  res.cookies.set(CSRF_COOKIE, "", { path: "/", maxAge: 0 });
}

/** Reject cross-site state-changing requests (defence in depth alongside the CSRF token). */
export function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin) {
    // Browsers always send Origin on cross-origin POST/fetch; absence + Sec-Fetch-Site cross-site is suspicious.
    const sfs = req.headers.get("sec-fetch-site");
    if (sfs && sfs !== "same-origin" && sfs !== "none") throw new AppError("FORBIDDEN", "Cross-site request blocked.");
    return;
  }
  let ok = false;
  try {
    const o = new URL(origin);
    ok = o.host === host || o.origin === new URL(config().APP_URL).origin;
  } catch {
    ok = false;
  }
  if (!ok) throw new AppError("FORBIDDEN", "Cross-site request blocked.");
}

export function errorResponse(e: unknown): NextResponse {
  const mapped = e instanceof AppError ? e : fromDbError(e);
  if (mapped) {
    return NextResponse.json(
      { error: { code: mapped.code, message: mapped.message, fields: mapped.fieldErrors ?? undefined } },
      { status: mapped.status },
    );
  }
  const ref = randomUUID().slice(0, 8);
  // Technical details go to the server log only (never to the user).
  console.error(`[error ${ref}]`, e);
  return NextResponse.json(
    { error: { code: "INTERNAL", message: `Something went wrong. Please try again or contact support (ref ${ref}).` } },
    { status: 500 },
  );
}

interface ApiOptions {
  /** Require authentication (default true). */
  auth?: boolean;
  permission?: Permission;
  /** Allow access while the user must still change their password. */
  allowPasswordChange?: boolean;
}

type Handler<C> = (ctx: { req: NextRequest; actor: Actor; session: ActiveSession; meta: RequestMeta; params: C }) => Promise<Response | unknown>;
type PublicHandler<C> = (ctx: { req: NextRequest; meta: RequestMeta; params: C }) => Promise<Response | unknown>;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Authenticated API route wrapper: session, CSRF, origin, permissions, error mapping. */
export function api<C = Record<string, string>>(handler: Handler<C>, opts: ApiOptions = {}) {
  return async (req: NextRequest, ctx: { params: Promise<C> }) => {
    try {
      const meta = requestMeta(req.headers);
      if (MUTATING.has(req.method)) checkOrigin(req);
      const token = req.cookies.get(SESSION_COOKIE)?.value;
      const session = await getSession(token);
      if (!session) throw new AppError("UNAUTHENTICATED", "Your session has expired. Please sign in again.");
      if (MUTATING.has(req.method)) {
        const sent = req.headers.get("x-csrf-token") ?? "";
        if (!sent || !safeEqual(sent, session.csrfToken)) throw new AppError("FORBIDDEN", "Security token missing or invalid. Refresh the page and try again.");
      }
      if (session.user.mustChangePassword && !opts.allowPasswordChange) {
        throw new AppError("FORBIDDEN", "You must change your password before continuing.");
      }
      if (opts.permission && !can(session.user.role, opts.permission)) {
        throw new AppError("FORBIDDEN", "You do not have permission to perform this action.");
      }
      const actor = actorFrom(session, meta);
      const params = (ctx?.params ? await ctx.params : {}) as C;
      const out = await handler({ req, actor, session, meta, params });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export function publicApi<C = Record<string, string>>(handler: PublicHandler<C>) {
  return async (req: NextRequest, ctx: { params: Promise<C> }) => {
    try {
      const meta = requestMeta(req.headers);
      if (MUTATING.has(req.method)) checkOrigin(req);
      const params = (ctx?.params ? await ctx.params : {}) as C;
      const out = await handler({ req, meta, params });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Parse a JSON body with a size cap. */
export async function readJson<T = Record<string, unknown>>(req: NextRequest, maxBytes = 256_000): Promise<T> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > maxBytes) throw new AppError("BAD_REQUEST", "Request is too large.");
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new AppError("BAD_REQUEST", "Expected JSON.");
  const text = await req.text();
  if (text.length > maxBytes) throw new AppError("BAD_REQUEST", "Request is too large.");
  try {
    const v = JSON.parse(text || "{}");
    if (v === null || typeof v !== "object") throw new Error();
    return v as T;
  } catch {
    throw new AppError("BAD_REQUEST", "Malformed request body.");
  }
}

export function xlsxResponse(buf: Buffer, fileName: string): Response {
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName.replace(/[^\w.\-]/g, "_")}"`,
      "Cache-Control": "no-store",
    },
  });
}

/* ───────────── server components ───────────── */

export async function currentSession(): Promise<ActiveSession | null> {
  const c = await cookies();
  return getSession(c.get(SESSION_COOKIE)?.value);
}

export async function pageActor(): Promise<Actor> {
  const s = await currentSession();
  if (!s) redirect("/login");
  const h = await headers();
  return actorFrom(s, requestMeta(h));
}

/** Guard for server-rendered pages. Redirects anonymous users; renders 403 for missing permission. */
export async function requirePage(permission?: Permission): Promise<{ session: ActiveSession; actor: Actor }> {
  const s = await currentSession();
  if (!s) redirect("/login");
  if (s.user.mustChangePassword) redirect("/account/password?required=1");
  if (permission && !can(s.user.role, permission)) redirect("/forbidden");
  const h = await headers();
  return { session: s, actor: actorFrom(s, requestMeta(h)) };
}

export function homeFor(role: string): string {
  if (role === "VENDOR_USER") return "/vendor";
  if (role === "FIELD_SUBMITTER") return "/my-requests";
  return "/dashboard";
}
