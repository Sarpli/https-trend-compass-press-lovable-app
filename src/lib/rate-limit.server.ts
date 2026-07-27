// Server-only rate-limit helper. Uses the SECURITY DEFINER
// `check_rate_limit` RPC backed by public.rate_limit_hits.
//
// Buckets are short strings ("ai_search", "delete_account", …). Keys
// combine an actor (user id when known, IP fallback) with the bucket.
// Callers should pass BOTH a user key (when signed in) and an IP key —
// whichever is more restrictive wins.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getRequest } from "@tanstack/react-start/server";
import { createHash } from "node:crypto";

let cachedAdmin: SupabaseClient<Database> | null = null;
function admin(): SupabaseClient<Database> {
  if (cachedAdmin) return cachedAdmin;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("rate-limit: missing SUPABASE_* env");
  cachedAdmin = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedAdmin;
}

export function getClientIp(req?: Request | null): string {
  const r = req ?? (() => { try { return getRequest(); } catch { return null; } })();
  if (!r) return "unknown";
  const h = r.headers;
  const fwd =
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "";
  return fwd || "unknown";
}

export class RateLimitError extends Error {
  status = 429 as const;
  retryAfter: number;
  /** Which bucket(s) tripped — useful for telemetry / debugging. */
  blocked: Array<{ bucket: string; max: number; windowSeconds: number; retryAfter: number }>;
  constructor(retryAfter: number, blocked: RateLimitError["blocked"] = []) {
    super("Too many requests. Please slow down and try again shortly.");
    this.retryAfter = retryAfter;
    this.blocked = blocked;
  }
}

type Check = { bucket: string; key: string; max: number; windowSeconds: number };

type EnforceOptions = {
  /** Logical route/action label used for telemetry (e.g. "auth.signin", "ai_search"). */
  route?: string;
  /** Optional user id for telemetry when available. */
  userId?: string | null;
};

async function one(c: Check): Promise<{ allowed: boolean; retryAfter: number }> {
  const { data, error } = await admin().rpc("check_rate_limit", {
    _bucket: c.bucket,
    _key: c.key,
    _max: c.max,
    _window_seconds: c.windowSeconds,
  });
  // Fail-open on infra errors so a limiter outage doesn't nuke the app,
  // but log to stderr for visibility.
  if (error) {
    console.warn("[rate-limit] check failed, allowing:", error.message);
    return { allowed: true, retryAfter: 0 };
  }
  const row = Array.isArray(data) ? data[0] : data;
  return {
    allowed: row?.allowed ?? true,
    retryAfter: row?.retry_after ?? 0,
  };
}

function hashKey(key: string): string {
  // Store only a short hash of the bucket key so raw emails/IPs stay
  // out of the telemetry table but per-actor grouping is still possible.
  try {
    return createHash("sha256").update(key).digest("hex").slice(0, 16);
  } catch {
    return "";
  }
}

async function logRateLimited(params: {
  route: string;
  blocked: Array<Check & { retryAfter: number }>;
  userId?: string | null;
}): Promise<void> {
  const { route, blocked, userId } = params;
  let ip: string | null = null;
  let ua: string | null = null;
  try {
    const req = getRequest();
    ip = getClientIp(req);
    ua = req?.headers.get("user-agent")?.slice(0, 256) ?? null;
  } catch {
    // no request context — server-side scheduled work
  }
  const rows = blocked.map((b) => ({
    route,
    bucket: b.bucket,
    limit_max: b.max,
    window_seconds: b.windowSeconds,
    retry_after: b.retryAfter,
    ip,
    user_id: userId ?? null,
    key_hash: hashKey(b.key),
    user_agent: ua,
  }));
  try {
    const { error } = await admin().from("rate_limit_events").insert(rows);
    if (error) console.warn("[rate-limit] telemetry insert failed:", error.message);
  } catch (e) {
    console.warn("[rate-limit] telemetry insert threw:", (e as Error).message);
  }
}

/**
 * Run one or more checks in parallel. Throws RateLimitError with the
 * largest retry-after when any bucket is exceeded.
 *
 * When `options.route` is provided, every blocked check is logged to
 * `public.rate_limit_events` for abuse monitoring / cap tuning. The
 * insert is awaited (not fire-and-forget) so the telemetry is durable
 * even when the request handler returns immediately after the throw.
 */
export async function enforceRateLimit(
  checks: Check[],
  options: EnforceOptions = {},
): Promise<void> {
  if (!checks.length) return;
  const results = await Promise.all(checks.map(one));
  const blockedPairs = checks
    .map((c, i) => ({ ...c, retryAfter: results[i].retryAfter, allowed: results[i].allowed }))
    .filter((r) => !r.allowed);
  if (blockedPairs.length) {
    const retryAfter = Math.max(...blockedPairs.map((r) => r.retryAfter), 1);
    if (options.route) {
      await logRateLimited({
        route: options.route,
        blocked: blockedPairs,
        userId: options.userId ?? null,
      });
    }
    throw new RateLimitError(
      retryAfter,
      blockedPairs.map((b) => ({
        bucket: b.bucket,
        max: b.max,
        windowSeconds: b.windowSeconds,
        retryAfter: b.retryAfter,
      })),
    );
  }
}

/** Build a rate-limited 429 Response for server route handlers. */
export function rateLimitResponse(err: RateLimitError): Response {
  return new Response(
    JSON.stringify({
      error: "rate_limited",
      retry_after_seconds: err.retryAfter,
      message: err.message,
    }),
    {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(err.retryAfter),
      },
    },
  );
}