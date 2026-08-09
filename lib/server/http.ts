// Web-standard responses (no next/server dependency) so Route Handlers stay
// unit-testable in a plain Node environment.

export function ok<T>(data: T, init?: ResponseInit) {
  return Response.json(data, init);
}

export function fail(status: number, error: string, extra?: Record<string, unknown>) {
  return Response.json({ error, ...extra }, { status });
}

/** Parse a JSON body, returning null on malformed input. */
export async function readJson<T = Record<string, unknown>>(
  req: Request,
): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

// ---------- naive in-memory rate limiter ----------
// Per-process, best-effort. Good enough for a single-classroom deployment; the
// real backstop for abuse is server-side validation + the unique constraints.
// Documented in docs/RIG-TEST.md for a hardening pass (Upstash/edge KV) later.
const buckets = new Map<string, { count: number; resetAt: number }>();

// Expired buckets are dead weight — without eviction the map grows with every
// distinct IP the isolate ever serves and only a Worker restart reclaims it.
// We sweep opportunistically on the writes that open a bucket, examining at
// most SWEEP_SCAN entries so a hot path never pays an unbounded cost. Map
// iteration is insertion-ordered and a refreshed bucket is re-inserted at the
// BACK (see the delete below), so expired entries collect at the FRONT — which
// is what makes a bounded front-scan effective. We deliberately do NOT stop at
// the first live entry: call sites may use different windows, so a long-window
// bucket at the front must not shield everything behind it from eviction.
const SWEEP_SCAN = 200;

function sweepExpired(now: number): void {
  let scanned = 0;
  for (const [key, b] of buckets) {
    if (now > b.resetAt) buckets.delete(key);
    if (++scanned >= SWEEP_SCAN) break;
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now(),
): boolean {
  const b = buckets.get(key);
  if (!b || now > b.resetAt) {
    // Delete-then-set so a refreshed bucket moves to the back of the insertion
    // order; `set` alone would keep it pinned at the front and block the sweep.
    buckets.delete(key);
    sweepExpired(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= limit) return false;
  b.count++;
  return true;
}

/** Live bucket count. Test-only introspection — not used by the app. */
export function rateLimitBucketCount(): number {
  return buckets.size;
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return fwd?.split(",")[0]?.trim() || "local";
}

/** Extract a Bearer token from the Authorization header, or null. */
export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}
