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
  constructor(retryAfter: number) {
    super("Too many requests. Please slow down and try again shortly.");
    this.retryAfter = retryAfter;
  }
}

type Check = { bucket: string; key: string; max: number; windowSeconds: number };

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

/**
 * Run one or more checks in parallel. Throws RateLimitError with the
 * largest retry-after when any bucket is exceeded.
 */
export async function enforceRateLimit(checks: Check[]): Promise<void> {
  if (!checks.length) return;
  const results = await Promise.all(checks.map(one));
  const blocked = results.filter((r) => !r.allowed);
  if (blocked.length) {
    const retryAfter = Math.max(...blocked.map((r) => r.retryAfter), 1);
    throw new RateLimitError(retryAfter);
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