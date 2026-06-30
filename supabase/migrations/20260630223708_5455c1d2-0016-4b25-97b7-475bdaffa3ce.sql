
-- 1. History table
CREATE TABLE IF NOT EXISTS public.synthetic_pulse_history (
  id bigserial PRIMARY KEY,
  trend_id uuid NOT NULL REFERENCES public.trends(id) ON DELETE CASCADE,
  synth_score numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.synthetic_pulse_history TO authenticated, anon;
GRANT ALL ON public.synthetic_pulse_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.synthetic_pulse_history_id_seq TO service_role;
ALTER TABLE public.synthetic_pulse_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read synth history"
  ON public.synthetic_pulse_history FOR SELECT
  USING (true);
CREATE INDEX IF NOT EXISTS synth_pulse_history_trend_time
  ON public.synthetic_pulse_history (trend_id, created_at DESC);
CREATE INDEX IF NOT EXISTS synth_pulse_history_time
  ON public.synthetic_pulse_history (created_at);

-- 2. Update tick function to log snapshots
CREATE OR REPLACE FUNCTION public.tick_synthetic_pulses()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
BEGIN
  WITH recent AS (
    SELECT
      tr.id AS trend_id,
      COALESCE(SUM(
        CASE
          WHEN v.created_at > now() - interval '1 hour'
            THEN (CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END) * 3
          WHEN v.created_at > now() - interval '24 hours'
            THEN (CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END)
          ELSE 0
        END
      ), 0)::numeric AS bias_raw,
      COALESCE(SUM(CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END), 0)::numeric AS total_net
    FROM public.trends tr
    LEFT JOIN public.votes v ON v.trend_id = tr.id
    GROUP BY tr.id
  ),
  ranked AS (
    SELECT trend_id, bias_raw, total_net,
           PERCENT_RANK() OVER (ORDER BY total_net) AS pop_pct
    FROM recent
  ),
  tier AS (
    SELECT trend_id, bias_raw, total_net, pop_pct,
      CASE
        WHEN pop_pct >= 0.80 THEN 6.0
        WHEN pop_pct >= 0.30 THEN 3.0
        ELSE 1.0
      END AS magnitude,
      CASE
        WHEN pop_pct < 0.30 THEN 0.6
        ELSE 0.0
      END AS skip_prob,
      GREATEST(-1.0, LEAST(1.0, bias_raw / 20.0)) AS bias
    FROM ranked
  ),
  deltas AS (
    SELECT t.trend_id,
      CASE WHEN random() < t.skip_prob THEN 0::numeric
      ELSE GREATEST(-8.0, LEAST(8.0,
        t.magnitude
        * (0.55 + 0.45 * t.bias)
        * (random() * 2.0 - 1.0 + 0.6 * t.bias)
      ))
      END AS delta
    FROM tier t
  ),
  upserted AS (
    INSERT INTO public.synthetic_pulses (trend_id, synth_score, last_tick_at, updated_at)
    SELECT d.trend_id, d.delta, now(), now()
    FROM deltas d
    ON CONFLICT (trend_id) DO UPDATE
      SET synth_score = (public.synthetic_pulses.synth_score * 0.985) + EXCLUDED.synth_score,
          last_tick_at = now(),
          updated_at = now()
    RETURNING trend_id, synth_score
  ),
  ev AS (
    INSERT INTO public.vote_events (trend_id)
    SELECT d.trend_id FROM deltas d WHERE d.delta <> 0
    RETURNING 1
  ),
  hist AS (
    INSERT INTO public.synthetic_pulse_history (trend_id, synth_score)
    SELECT u.trend_id, u.synth_score FROM upserted u
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upserted;

  RETURN v_count;
END;
$function$;

-- 3. Update price history RPC to append synthetic trailing series
CREATE OR REPLACE FUNCTION public.get_trend_price_history(_trend_id uuid)
 RETURNS TABLE(t timestamp with time zone, price numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_base numeric;
  v_start timestamptz;
  v_now timestamptz := date_trunc('month', now());
  v_months int;
  v_has_anchors bool;
  v_seed bigint;
  v_anchor_start timestamptz;
  v_peak numeric;
  v_vol numeric;
  v_net_week numeric;
  v_net_month numeric;
  v_net_year numeric;
  v_net_oat numeric;
  v_tilt numeric;
  v_floor_boost numeric;
  v_recent_kick numeric;
  v_last_monthly_price numeric;
  v_synth_base numeric;
BEGIN
  SELECT
    tr.base_price,
    COALESCE(
      CASE WHEN tr.origin_year IS NOT NULL
           THEN make_timestamptz(tr.origin_year, 1, 1, 0, 0, 0)
      END,
      date_trunc('year', tr.created_at),
      date_trunc('year', now())
    ),
    ('x' || substr(md5(tr.id::text), 1, 12))::bit(48)::bigint
  INTO v_base, v_start, v_seed
  FROM public.trends tr WHERE tr.id = _trend_id;

  IF v_base IS NULL THEN RETURN; END IF;

  SELECT MIN(make_timestamptz(year, month, 1, 0, 0, 0)),
         COALESCE(MAX(intensity), 50)
    INTO v_anchor_start, v_peak
  FROM public.trend_popularity WHERE trend_id = _trend_id;
  IF v_anchor_start IS NOT NULL AND v_anchor_start < v_start THEN
    v_start := v_anchor_start;
  END IF;

  v_months := GREATEST(1, ((EXTRACT(YEAR FROM v_now)-EXTRACT(YEAR FROM v_start))*12
              + (EXTRACT(MONTH FROM v_now)-EXTRACT(MONTH FROM v_start)))::int);

  SELECT EXISTS (SELECT 1 FROM public.trend_popularity WHERE trend_id = _trend_id) INTO v_has_anchors;

  SELECT
    COALESCE(SUM(CASE WHEN category='week'  THEN CASE WHEN direction='up' THEN weight ELSE -weight END END), 0),
    COALESCE(SUM(CASE WHEN category='month' THEN CASE WHEN direction='up' THEN weight ELSE -weight END END), 0),
    COALESCE(SUM(CASE WHEN category='year'  THEN CASE WHEN direction='up' THEN weight ELSE -weight END END), 0),
    COALESCE(SUM(CASE WHEN category='oat'   THEN CASE WHEN direction='up' THEN weight ELSE -weight END END), 0)
  INTO v_net_week, v_net_month, v_net_year, v_net_oat
  FROM public.votes WHERE trend_id = _trend_id;

  v_tilt := GREATEST(-0.30, LEAST(0.65,
              (v_net_month * 0.022) + (v_net_week * 0.030) + (v_net_year * 0.008)
            ));
  v_floor_boost := GREATEST(-0.10, LEAST(0.45, v_net_oat * 0.012));
  v_recent_kick := GREATEST(-0.08, LEAST(0.18, v_net_week * 0.012));
  v_vol := 0.08 + LEAST(0.24, COALESCE(v_peak, 50) / 100.0 * 0.28);

  RETURN QUERY
  WITH months AS (
    SELECT i, (v_start + (i || ' month')::interval) AS month_ts
    FROM generate_series(0, v_months) AS g(i)
  ),
  anchors AS (
    SELECT year, month, intensity,
           make_timestamptz(year, month, 1, 0, 0, 0) AS ts
    FROM public.trend_popularity
    WHERE trend_id = _trend_id
  ),
  interp AS (
    SELECT m.month_ts,
      (SELECT intensity FROM anchors a WHERE a.ts <= m.month_ts ORDER BY a.ts DESC LIMIT 1) AS prev_v,
      (SELECT EXTRACT(EPOCH FROM (m.month_ts - a.ts))/86400.0 FROM anchors a WHERE a.ts <= m.month_ts ORDER BY a.ts DESC LIMIT 1) AS prev_age,
      (SELECT intensity FROM anchors a WHERE a.ts >= m.month_ts ORDER BY a.ts ASC LIMIT 1) AS next_v,
      (SELECT EXTRACT(EPOCH FROM (a.ts - m.month_ts))/86400.0 FROM anchors a WHERE a.ts >= m.month_ts ORDER BY a.ts ASC LIMIT 1) AS next_age,
      m.i
    FROM months m
  ),
  vote_months AS (
    SELECT date_trunc('month', created_at) AS month_ts,
           SUM(CASE WHEN direction='up' THEN weight ELSE -weight END)::numeric AS net_delta
    FROM public.votes WHERE trend_id = _trend_id GROUP BY 1
  ),
  cum AS (
    SELECT m.month_ts,
      SUM(COALESCE(vm.net_delta,0)) OVER (ORDER BY m.month_ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_net,
      m.i
    FROM months m LEFT JOIN vote_months vm ON vm.month_ts = m.month_ts
  ),
  shaped AS (
    SELECT i.month_ts,
      CASE
        WHEN v_has_anchors AND i.prev_v IS NOT NULL AND i.next_v IS NOT NULL AND (i.prev_age + i.next_age) > 0 THEN
          (i.prev_v * i.next_age + i.next_v * i.prev_age) / (i.prev_age + i.next_age)
        WHEN v_has_anchors AND i.prev_v IS NOT NULL THEN i.prev_v
        WHEN v_has_anchors AND i.next_v IS NOT NULL THEN i.next_v
        ELSE
          (
            100.0 * (
              (0.18 + v_floor_boost)
              + (0.82 - v_floor_boost * 0.4)
                / (1.0 + EXP(-6.0 * ((i.i::numeric / NULLIF(v_months,0)) - 0.30)))
            )
          )
          * (1.0 + v_tilt * GREATEST(0, (i.i::numeric / NULLIF(v_months,0)) - 0.40) * 1.7)
          * (1.0 + CASE WHEN i.i = v_months THEN v_recent_kick ELSE 0 END)
          * (1.0 + 0.18 * SIN(((v_seed % 360)::numeric + i.i * (28 + (v_seed % 27))) * pi() / 180.0))
      END AS intensity,
      c.cum_net,
      i.i
    FROM interp i JOIN cum c ON c.month_ts = i.month_ts
  ),
  noisy AS (
    SELECT s.month_ts, s.intensity, s.cum_net,
      s.intensity * (
        1.0
        + v_vol * 0.45 * SIN(((v_seed %  360)::numeric + s.i * (7  + (v_seed % 11))) * pi() / 180.0)
        + v_vol * 0.30 * SIN(((v_seed %  720)::numeric + s.i * (23 + (v_seed % 17))) * pi() / 180.0)
        + v_vol * 0.18 * SIN(((v_seed % 1080)::numeric + s.i * (47 + (v_seed % 29))) * pi() / 180.0)
        + v_vol * 0.40 * ((('x' || substr(md5(_trend_id::text || ':a:' || s.i::text), 1, 8))::bit(32)::bigint % 2000 - 1000) / 1000.0)
        + v_vol * 0.25 * ((('x' || substr(md5(_trend_id::text || ':b:' || s.i::text), 1, 8))::bit(32)::bigint % 2000 - 1000) / 1000.0)
        + CASE
            WHEN (('x' || substr(md5(_trend_id::text || ':s:' || s.i::text), 1, 8))::bit(32)::bigint % 7) = 0
            THEN v_vol * 0.90 * ((('x' || substr(md5(_trend_id::text || ':k:' || s.i::text), 1, 8))::bit(32)::bigint % 2000 - 1000) / 1000.0)
            ELSE 0
          END
      ) AS noisy_intensity
    FROM shaped s
  ),
  monthly AS (
    SELECT n.month_ts AS t,
      GREATEST(v_base * 0.20,
        v_base * (0.45 + 0.012 * n.noisy_intensity) + (1.5 * COALESCE(n.cum_net, 0))
      )::numeric AS price
    FROM noisy n
  ),
  last_monthly AS (
    SELECT price FROM monthly ORDER BY t DESC LIMIT 1
  ),
  synth AS (
    SELECT created_at AS t, synth_score
    FROM public.synthetic_pulse_history
    WHERE trend_id = _trend_id
      AND created_at > now() - interval '7 days'
    ORDER BY created_at
  ),
  synth_baseline AS (
    SELECT synth_score AS base_synth FROM synth ORDER BY t LIMIT 1
  ),
  synth_priced AS (
    SELECT s.t,
      GREATEST(v_base * 0.20,
        (SELECT price FROM last_monthly) + 1.5 * (s.synth_score - COALESCE((SELECT base_synth FROM synth_baseline), 0))
      )::numeric AS price
    FROM synth s
  )
  SELECT * FROM monthly
  UNION ALL
  SELECT * FROM synth_priced
  ORDER BY 1;
END
$function$;

-- 4. Prune old snapshots (extend existing prune_perf_events-style cleanup via cron-friendly fn)
CREATE OR REPLACE FUNCTION public.prune_synthetic_pulse_history()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE n int;
BEGIN
  WITH d AS (
    DELETE FROM public.synthetic_pulse_history
    WHERE created_at < now() - interval '14 days'
    RETURNING 1
  )
  SELECT count(*) INTO n FROM d;
  RETURN n;
END;
$function$;

SELECT cron.schedule(
  'prune-synth-pulse-history',
  '17 3 * * *',
  $$SELECT public.prune_synthetic_pulse_history();$$
);
