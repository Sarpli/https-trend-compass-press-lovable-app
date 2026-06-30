// Lightweight client perf tracing. Batches samples and flushes them to
// public.perf_events via the Supabase Data API. Designed to be cheap and
// fire-and-forget — never block the UI on a flush.

import { supabase } from "@/integrations/supabase/client";

type Surface = "client" | "server";

type Sample = {
  metric: string;
  surface: Surface;
  route?: string | null;
  duration_ms: number;
  query_count?: number | null;
  metadata?: Record<string, unknown> | null;
};

const queue: Sample[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const FLUSH_MS = 4000;
const MAX_QUEUE = 50;
// Per-metric token bucket: cap at most N samples per minute per metric to
// keep the table small and avoid runaway reporting from a hot loop.
const PER_MIN_CAP = 30;
const counters = new Map<string, { count: number; resetAt: number }>();

function allow(metric: string): boolean {
  const now = Date.now();
  const c = counters.get(metric);
  if (!c || c.resetAt < now) {
    counters.set(metric, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (c.count >= PER_MIN_CAP) return false;
  c.count += 1;
  return true;
}

function scheduleFlush() {
  if (flushTimer || typeof window === "undefined") return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flush();
  }, FLUSH_MS);
}

async function flush() {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  try {
    await supabase.from("perf_events").insert(batch as never);
  } catch {
    // swallow — telemetry must never throw
  }
}

export function recordPerf(sample: Sample): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(sample.duration_ms) || sample.duration_ms < 0) return;
  if (!allow(sample.metric)) return;
  const route = sample.route ?? (typeof location !== "undefined" ? location.pathname : null);
  queue.push({ ...sample, route });
  if (queue.length >= MAX_QUEUE) {
    void flush();
  } else {
    scheduleFlush();
  }
}

// Wrap an async fn and record its duration + a query counter passed in via
// the callback. Returns the original result.
export async function tracePerf<T>(
  metric: string,
  fn: () => Promise<T>,
  opts: { surface?: Surface; metadata?: Record<string, unknown>; queries?: number } = {},
): Promise<T> {
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  try {
    const result = await fn();
    recordPerf({
      metric,
      surface: opts.surface ?? "client",
      duration_ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - start,
      query_count: opts.queries ?? 1,
      metadata: opts.metadata ?? null,
    });
    return result;
  } catch (err) {
    recordPerf({
      metric: `${metric}.error`,
      surface: opts.surface ?? "client",
      duration_ms: (typeof performance !== "undefined" ? performance.now() : Date.now()) - start,
      metadata: { error: String((err as Error)?.message ?? err) },
    });
    throw err;
  }
}

// Flush on tab hide so we don't lose the trailing batch.
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
  window.addEventListener("pagehide", () => {
    void flush();
  });
}
