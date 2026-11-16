/**
 * Fixed-window in-memory rate limiter (per process). Complements the DB-backed account lockout.
 * For multi-instance deployments put a shared limiter (e.g. Redis / API gateway) in front — see docs.
 */
type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function sweep(now: number) {
  if (buckets.size > 50_000) for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/** Count this call and report whether the limit is exceeded. */
export function rateLimit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  sweep(now);
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0 };
  }
  b.count++;
  if (b.count > limit) return { ok: false, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, retryAfterSec: 0 };
}

/** Check without counting (used to throttle on failures only). */
export function isLimited(key: string, limit: number): { limited: boolean; retryAfterSec: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) return { limited: false, retryAfterSec: 0 };
  return { limited: b.count >= limit, retryAfterSec: Math.ceil((b.resetAt - now) / 1000) };
}

/** Record a failure against a key. */
export function recordFailure(key: string, windowMs: number) {
  rateLimit(key, Number.MAX_SAFE_INTEGER, windowMs);
}

export function resetRateLimits() {
  buckets.clear();
}
