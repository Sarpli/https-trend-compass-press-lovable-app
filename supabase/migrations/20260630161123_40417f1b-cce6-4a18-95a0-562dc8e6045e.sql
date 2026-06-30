
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Alerts table
CREATE TABLE public.pro_upgrade_intent_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,                  -- 'spike' | 'drop' | 'user_brigade'
  severity text NOT NULL,              -- 'info' | 'warn' | 'critical'
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  observed numeric NOT NULL,
  baseline numeric NOT NULL,
  ratio numeric,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pro_upgrade_intent_alerts TO authenticated;
GRANT ALL ON public.pro_upgrade_intent_alerts TO service_role;

ALTER TABLE public.pro_upgrade_intent_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read intent alerts"
  ON public.pro_upgrade_intent_alerts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX pro_upgrade_intent_alerts_created_idx
  ON public.pro_upgrade_intent_alerts (created_at DESC);
CREATE INDEX pro_upgrade_intent_alerts_kind_idx
  ON public.pro_upgrade_intent_alerts (kind, created_at DESC);

-- Retention: drop intents older than 90 days
CREATE OR REPLACE FUNCTION public.prune_pro_upgrade_intents()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_deleted int;
BEGIN
  WITH d AS (
    DELETE FROM public.pro_upgrade_intents
     WHERE created_at < now() - interval '90 days'
     RETURNING 1
  )
  SELECT COUNT(*) INTO v_deleted FROM d;

  -- Also prune resolved alerts older than 180 days
  DELETE FROM public.pro_upgrade_intent_alerts
   WHERE created_at < now() - interval '180 days';

  RETURN v_deleted;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.prune_pro_upgrade_intents() FROM PUBLIC, anon, authenticated;

-- Anomaly detector
CREATE OR REPLACE FUNCTION public.detect_pro_upgrade_intent_anomalies()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_window_start timestamptz := now() - interval '1 hour';
  v_window_end   timestamptz := now();
  v_observed numeric;
  v_baseline_hourly numeric;
  v_ratio numeric;
  v_alerts int := 0;
  v_top_user uuid;
  v_top_user_count int;
  v_total_recent int;
BEGIN
  -- Volume in the trailing hour
  SELECT COUNT(*) INTO v_observed
    FROM public.pro_upgrade_intents
   WHERE created_at >= v_window_start AND created_at < v_window_end;

  -- Trailing 24h baseline (excluding the most recent hour) → per-hour rate
  SELECT COUNT(*)::numeric / 23.0 INTO v_baseline_hourly
    FROM public.pro_upgrade_intents
   WHERE created_at >= now() - interval '24 hours'
     AND created_at <  v_window_start;

  v_baseline_hourly := GREATEST(v_baseline_hourly, 1); -- avoid div-by-zero and noise at low volume
  v_ratio := v_observed / v_baseline_hourly;

  -- Dedup: only fire one alert per kind per 30 min
  IF v_observed >= 20 AND v_ratio >= 4.0 AND NOT EXISTS (
       SELECT 1 FROM public.pro_upgrade_intent_alerts
        WHERE kind = 'spike' AND created_at > now() - interval '30 minutes'
     ) THEN
    INSERT INTO public.pro_upgrade_intent_alerts
      (kind, severity, window_start, window_end, observed, baseline, ratio, details)
    VALUES ('spike',
            CASE WHEN v_ratio >= 10 THEN 'critical' ELSE 'warn' END,
            v_window_start, v_window_end, v_observed, v_baseline_hourly, v_ratio,
            jsonb_build_object('hint','Possible paywall regression, viral term, or RLS misconfig letting more writes through.'));
    v_alerts := v_alerts + 1;
  END IF;

  -- Drop: previously busy, now silent → could be a broken trigger / RLS lockout
  IF v_baseline_hourly >= 5 AND v_observed = 0 AND NOT EXISTS (
       SELECT 1 FROM public.pro_upgrade_intent_alerts
        WHERE kind = 'drop' AND created_at > now() - interval '60 minutes'
     ) THEN
    INSERT INTO public.pro_upgrade_intent_alerts
      (kind, severity, window_start, window_end, observed, baseline, ratio, details)
    VALUES ('drop', 'warn', v_window_start, v_window_end, v_observed, v_baseline_hourly, 0,
            jsonb_build_object('hint','Zero blocked attempts despite recent baseline. Trigger or vote path may be broken.'));
    v_alerts := v_alerts + 1;
  END IF;

  -- Single-user brigade in last hour
  SELECT user_id, COUNT(*) INTO v_top_user, v_top_user_count
    FROM public.pro_upgrade_intents
   WHERE created_at >= v_window_start AND user_id IS NOT NULL
   GROUP BY user_id
   ORDER BY COUNT(*) DESC
   LIMIT 1;

  SELECT GREATEST(COUNT(*), 1) INTO v_total_recent
    FROM public.pro_upgrade_intents
   WHERE created_at >= v_window_start;

  IF v_top_user IS NOT NULL
     AND v_top_user_count >= 25
     AND (v_top_user_count::numeric / v_total_recent) >= 0.5
     AND NOT EXISTS (
       SELECT 1 FROM public.pro_upgrade_intent_alerts
        WHERE kind = 'user_brigade'
          AND details->>'user_id' = v_top_user::text
          AND created_at > now() - interval '60 minutes'
     ) THEN
    INSERT INTO public.pro_upgrade_intent_alerts
      (kind, severity, window_start, window_end, observed, baseline, ratio, details)
    VALUES ('user_brigade', 'warn', v_window_start, v_window_end,
            v_top_user_count, v_total_recent, v_top_user_count::numeric / v_total_recent,
            jsonb_build_object('user_id', v_top_user, 'hint','Single user driving most blocked attempts — likely retry loop or scripted abuse.'));
    v_alerts := v_alerts + 1;
  END IF;

  RETURN v_alerts;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.detect_pro_upgrade_intent_anomalies() FROM PUBLIC, anon, authenticated;

-- Schedule jobs
SELECT cron.schedule(
  'prune-pro-upgrade-intents-daily',
  '17 3 * * *',
  $$ SELECT public.prune_pro_upgrade_intents(); $$
);

SELECT cron.schedule(
  'detect-pro-upgrade-intent-anomalies',
  '*/10 * * * *',
  $$ SELECT public.detect_pro_upgrade_intent_anomalies(); $$
);
