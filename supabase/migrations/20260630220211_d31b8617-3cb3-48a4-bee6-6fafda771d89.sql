
-- perf_events: raw samples
CREATE TABLE IF NOT EXISTS public.perf_events (
  id bigserial PRIMARY KEY,
  metric text NOT NULL,
  surface text NOT NULL CHECK (surface IN ('client','server')),
  route text,
  duration_ms double precision NOT NULL CHECK (duration_ms >= 0 AND duration_ms < 600000),
  query_count integer,
  user_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS perf_events_metric_created_idx
  ON public.perf_events (metric, created_at DESC);

GRANT INSERT ON public.perf_events TO anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.perf_events_id_seq TO anon, authenticated;
GRANT ALL ON public.perf_events TO service_role;

ALTER TABLE public.perf_events ENABLE ROW LEVEL SECURITY;

-- Clients can insert their own events, but not read anything.
CREATE POLICY perf_events_insert_any ON public.perf_events
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    duration_ms >= 0
    AND duration_ms < 600000
    AND length(metric) BETWEEN 1 AND 64
    AND (route IS NULL OR length(route) <= 256)
  );

CREATE POLICY perf_events_admin_read ON public.perf_events
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- perf_alerts: regression notifications
CREATE TABLE IF NOT EXISTS public.perf_alerts (
  id bigserial PRIMARY KEY,
  metric text NOT NULL,
  surface text NOT NULL,
  current_p95_ms double precision NOT NULL,
  baseline_p95_ms double precision NOT NULL,
  threshold_pct double precision NOT NULL,
  sample_count integer NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS perf_alerts_created_idx
  ON public.perf_alerts (created_at DESC);

GRANT SELECT ON public.perf_alerts TO authenticated;
GRANT ALL ON public.perf_alerts TO service_role;

ALTER TABLE public.perf_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY perf_alerts_admin_read ON public.perf_alerts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Server-side helper: regression check
CREATE OR REPLACE FUNCTION public.check_perf_regressions()
RETURNS TABLE(metric text, surface text, current_p95 double precision, baseline_p95 double precision, pct_regression double precision, alerted boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_alerted boolean;
  THRESHOLD_PCT double precision := 50.0; -- regression if current p95 > baseline * 1.5
  MIN_SAMPLES integer := 20;
  MIN_ABSOLUTE_MS double precision := 50.0; -- ignore very fast metrics
BEGIN
  FOR r IN
    WITH recent AS (
      SELECT pe.metric, pe.surface,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY pe.duration_ms) AS p95,
             count(*) AS n
      FROM public.perf_events pe
      WHERE pe.created_at > now() - interval '1 hour'
      GROUP BY pe.metric, pe.surface
    ),
    baseline AS (
      SELECT pe.metric, pe.surface,
             percentile_cont(0.95) WITHIN GROUP (ORDER BY pe.duration_ms) AS p95,
             count(*) AS n
      FROM public.perf_events pe
      WHERE pe.created_at BETWEEN now() - interval '25 hours' AND now() - interval '1 hour'
      GROUP BY pe.metric, pe.surface
    )
    SELECT recent.metric, recent.surface, recent.p95 AS cur, baseline.p95 AS base, recent.n AS n
    FROM recent
    JOIN baseline USING (metric, surface)
    WHERE recent.n >= MIN_SAMPLES
      AND baseline.p95 > MIN_ABSOLUTE_MS
      AND recent.p95 > baseline.p95 * (1 + THRESHOLD_PCT/100.0)
  LOOP
    v_alerted := false;
    -- de-dupe: only alert if we haven't alerted on this metric in the last hour
    IF NOT EXISTS (
      SELECT 1 FROM public.perf_alerts pa
      WHERE pa.metric = r.metric AND pa.surface = r.surface
        AND pa.created_at > now() - interval '1 hour'
    ) THEN
      INSERT INTO public.perf_alerts(metric, surface, current_p95_ms, baseline_p95_ms, threshold_pct, sample_count, details)
      VALUES (r.metric, r.surface, r.cur, r.base, THRESHOLD_PCT, r.n,
              jsonb_build_object('window','1h','baseline_window','24h'));
      v_alerted := true;
    END IF;
    metric := r.metric;
    surface := r.surface;
    current_p95 := r.cur;
    baseline_p95 := r.base;
    pct_regression := ((r.cur - r.base) / NULLIF(r.base,0)) * 100.0;
    alerted := v_alerted;
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.check_perf_regressions() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_perf_regressions() TO service_role;

-- Pruning: keep 7 days of raw samples, 30 days of alerts
CREATE OR REPLACE FUNCTION public.prune_perf_events()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.perf_events WHERE created_at < now() - interval '7 days';
  DELETE FROM public.perf_alerts WHERE created_at < now() - interval '30 days';
$$;

REVOKE ALL ON FUNCTION public.prune_perf_events() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prune_perf_events() TO service_role;
