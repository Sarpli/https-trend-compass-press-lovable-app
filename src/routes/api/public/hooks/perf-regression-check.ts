import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

// Runs the regression check + prunes old samples. Triggered by pg_cron with
// the project's anon key in the `apikey` header. Returns the rows that
// regressed (and whether an alert row was written) so cron logs are useful.
export const Route = createFileRoute("/api/public/hooks/perf-regression-check")({
  server: {
    handlers: {
      POST: async () => {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!url || !key) {
          return new Response(JSON.stringify({ error: "missing_env" }), { status: 500 });
        }
        const admin = createClient<Database>(url, key, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const t0 = performance.now();
        const { data, error } = await admin.rpc("check_perf_regressions");
        const checkMs = performance.now() - t0;
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }
        try { await admin.rpc("prune_perf_events"); } catch {}
        // Record server-side cron timing so the dashboard sees server health too.
        await admin.from("perf_events").insert({
          metric: "server.cron.regression_check",
          surface: "server",
          duration_ms: checkMs,
          query_count: 2,
          metadata: { regressions: (data ?? []).length },
        });
        return new Response(
          JSON.stringify({ ok: true, regressions: data ?? [], check_ms: checkMs }),
          { headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
