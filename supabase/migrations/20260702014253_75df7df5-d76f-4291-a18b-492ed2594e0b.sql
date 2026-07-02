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
  v_pop_stddev numeric;
  v_pop_mean numeric;
  v_vol numeric;
  v_recent_net numeric;
  v_total_net numeric;
  v_pop_rank numeric;
  v_age_years numeric;
  v_newness numeric;
  v_direction numeric;
  v_drift numeric;
  v_cycle_a int;
  v_cycle_b int;
  v_cycle_c int;
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
    ('x' || substr(md5(tr.id::text), 1, 12))::bit(48)::bigint,
    GREATEST(0, EXTRACT(YEAR FROM now()) - COALESCE(tr.origin_year, EXTRACT(YEAR FROM tr.created_at)))
  INTO v_base, v_start, v_seed, v_age_years
  FROM public.trends tr WHERE tr.id = _trend_id;

  IF v_base IS NULL THEN RETURN; END IF;

  SELECT MIN(make_timestamptz(tp.year, tp.month, 1, 0, 0, 0)),
         COALESCE(MAX(tp.intensity), 50),
         COALESCE(STDDEV_POP(tp.intensity), 0),
         COALESCE(AVG(tp.intensity), 50)
    INTO v_anchor_start, v_peak, v_pop_stddev, v_pop_mean
  FROM public.trend_popularity tp WHERE tp.trend_id = _trend_id;
  IF v_anchor_start IS NOT NULL AND v_anchor_start < v_start THEN
    v_start := v_anchor_start;
  END IF;

  v_months := GREATEST(1, ((EXTRACT(YEAR FROM v_now)-EXTRACT(YEAR FROM v_start))*12
              + (EXTRACT(MONTH FROM v_now)-EXTRACT(MONTH FROM v_start)))::int);

  SELECT EXISTS (SELECT 1 FROM public.trend_popularity tp WHERE tp.trend_id = _trend_id) INTO v_has_anchors;

  SELECT COALESCE(SUM(CASE WHEN vv.direction='up' THEN vv.weight ELSE -vv.weight END), 0)
    INTO v_total_net
  FROM public.votes vv WHERE vv.trend_id = _trend_id;

  SELECT COALESCE(SUM(CASE WHEN vv.direction='up' THEN vv.weight ELSE -vv.weight END), 0)
    INTO v_recent_net
  FROM public.votes vv
  WHERE vv.trend_id = _trend_id AND vv.created_at > now() - interval '30 days';

  SELECT COALESCE(pr, 0.5) INTO v_pop_rank FROM (
    SELECT PERCENT_RANK() OVER (ORDER BY n) AS pr, s.trend_id FROM (
      SELECT v.trend_id,
             SUM(CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END)::numeric AS n
      FROM public.votes v GROUP BY v.trend_id
    ) s
  ) r WHERE r.trend_id = _trend_id;

  -- Newness: 1.0 for a brand-new term, 0.0 for >= 8 years old.
  v_newness := GREATEST(0, LEAST(1, (8 - v_age_years) / 8.0));

  -- Direction in [-1, 1]. Positive = bullish, negative = bearish.
  --   New + popular → strong bullish
  --   Old + niche  → strong bearish
  --   Recent vote momentum nudges either way
  v_direction := GREATEST(-1.0, LEAST(1.0,
      (v_pop_rank - 0.45) * 1.10       -- popularity is the main lever
    + (v_newness - 0.45) * 0.90        -- newness heavily favors bullish
    + TANH(v_recent_net / 60.0) * 0.35 -- recent votes nudge
    + TANH(v_total_net  / 400.0) * 0.15
    - CASE WHEN v_age_years >= 6 AND v_pop_rank < 0.6 THEN 0.35 ELSE 0 END  -- old & not popular = extra bearish
  ));

  -- Drift per month (compounds via EXP over the walk).
  v_drift := v_direction * 0.024;

  -- Volatility floor guarantees visible fluctuation for every term.
  v_vol := 0.09                                                            -- floor
         + LEAST(0.18, COALESCE(v_peak, 40) / 100.0 * 0.22)                -- peak height
         + LEAST(0.14, COALESCE(v_pop_stddev, 0) / 100.0 * 0.40)           -- choppiness
         + LEAST(0.10, GREATEST(0, v_pop_rank - 0.35) * 0.22)              -- popularity
         + LEAST(0.06, ABS(v_total_net) / 300.0 * 0.10)                    -- lifetime activity
         + LEAST(0.06, ABS(v_recent_net) / 80.0 * 0.10);                   -- recent activity

  v_cycle_a := 5  + ((v_seed / 7)  % 11)::int;
  v_cycle_b := 17 + ((v_seed / 13) % 19)::int;
  v_cycle_c := 41 + ((v_seed / 29) % 23)::int;

  RETURN QUERY
  WITH months AS (
    SELECT g.i, (v_start + (g.i || ' month')::interval) AS month_ts
    FROM generate_series(0, v_months) AS g(i)
  ),
  anchors AS (
    SELECT tp.year, tp.month, tp.intensity,
           make_timestamptz(tp.year, tp.month, 1, 0, 0, 0) AS ts
    FROM public.trend_popularity tp WHERE tp.trend_id = _trend_id
  ),
  interp AS (
    SELECT m.month_ts, m.i,
      (SELECT a.intensity FROM anchors a WHERE a.ts <= m.month_ts ORDER BY a.ts DESC LIMIT 1) AS prev_v,
      (SELECT EXTRACT(EPOCH FROM (m.month_ts - a.ts))/86400.0 FROM anchors a WHERE a.ts <= m.month_ts ORDER BY a.ts DESC LIMIT 1) AS prev_age,
      (SELECT a.intensity FROM anchors a WHERE a.ts >= m.month_ts ORDER BY a.ts ASC LIMIT 1) AS next_v,
      (SELECT EXTRACT(EPOCH FROM (a.ts - m.month_ts))/86400.0 FROM anchors a WHERE a.ts >= m.month_ts ORDER BY a.ts ASC LIMIT 1) AS next_age
    FROM months m
  ),
  vote_months AS (
    SELECT date_trunc('month', vv.created_at) AS month_ts,
           SUM(CASE WHEN vv.direction='up' THEN vv.weight ELSE -vv.weight END)::numeric AS net_delta
    FROM public.votes vv WHERE vv.trend_id = _trend_id GROUP BY 1
  ),
  cum AS (
    SELECT m.month_ts, m.i,
      SUM(COALESCE(vm.net_delta,0)) OVER (ORDER BY m.month_ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_net
    FROM months m LEFT JOIN vote_months vm ON vm.month_ts = m.month_ts
  ),
  steps AS (
    SELECT i.month_ts, i.i, c.cum_net, i.prev_v, i.next_v, i.prev_age, i.next_age,
      (
        v_drift
        + v_vol * 0.060 * SIN(((v_seed %  360)::numeric + i.i * (360.0 / v_cycle_a)) * pi() / 180.0)
        + v_vol * 0.040 * SIN(((v_seed %  720)::numeric + i.i * (360.0 / v_cycle_b)) * pi() / 180.0)
        + v_vol * 0.026 * SIN(((v_seed % 1080)::numeric + i.i * (360.0 / v_cycle_c)) * pi() / 180.0)
        + v_vol * 0.085 * (
            ((('x' || substr(md5(_trend_id::text || ':a:' || i.i::text), 1, 8))::bit(32)::bigint % 2000 - 1000) / 1000.0)
            + v_direction * 0.30
          )
        + v_vol * 0.050 * (
            ((('x' || substr(md5(_trend_id::text || ':b:' || i.i::text), 1, 8))::bit(32)::bigint % 2000 - 1000) / 1000.0)
            + v_direction * 0.20
          )
        + CASE
            WHEN (('x' || substr(md5(_trend_id::text || ':s:' || i.i::text), 1, 8))::bit(32)::bigint
                  % GREATEST(4, (16 - (v_vol * 32)::int))) = 0
            THEN v_vol * 0.150 * (
              ((('x' || substr(md5(_trend_id::text || ':k:' || i.i::text), 1, 8))::bit(32)::bigint % 2000 - 1000) / 1000.0)
              + v_direction * 0.55
            )
            ELSE 0
          END
      ) AS step_pct
    FROM interp i JOIN cum c ON c.month_ts = i.month_ts
  ),
  walk AS (
    SELECT s.month_ts, s.i, s.cum_net, s.prev_v, s.next_v, s.prev_age, s.next_age,
      EXP(SUM(s.step_pct) OVER (ORDER BY s.i ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)) AS mult
    FROM steps s
  ),
  monthly AS (
    SELECT w.month_ts AS mt,
      CASE
        WHEN v_has_anchors AND w.prev_v IS NOT NULL AND w.next_v IS NOT NULL AND (w.prev_age + w.next_age) > 0 THEN
          GREATEST(v_base * 0.15,
            v_base * (0.50 + 0.012 *
              ((w.prev_v * w.next_age + w.next_v * w.prev_age) / (w.prev_age + w.next_age))
            ) * w.mult + 1.5 * COALESCE(w.cum_net, 0)
          )
        WHEN v_has_anchors AND COALESCE(w.prev_v, w.next_v) IS NOT NULL THEN
          GREATEST(v_base * 0.15,
            v_base * (0.50 + 0.012 * COALESCE(w.prev_v, w.next_v)) * w.mult + 1.5 * COALESCE(w.cum_net, 0)
          )
        ELSE
          GREATEST(v_base * 0.15, v_base * w.mult + 1.5 * COALESCE(w.cum_net, 0))
      END::numeric AS mp
    FROM walk w
  ),
  last_monthly AS (SELECT m.mp AS lp FROM monthly m ORDER BY m.mt DESC LIMIT 1),
  synth AS (
    SELECT sph.created_at AS st, sph.synth_score
    FROM public.synthetic_pulse_history sph
    WHERE sph.trend_id = _trend_id AND sph.created_at > now() - interval '7 days'
    ORDER BY sph.created_at
  ),
  synth_baseline AS (SELECT sy.synth_score AS base_synth FROM synth sy ORDER BY sy.st LIMIT 1),
  synth_priced AS (
    SELECT sy.st AS mt,
      GREATEST(v_base * 0.15,
        (SELECT lp FROM last_monthly) + 1.5 * (sy.synth_score - COALESCE((SELECT base_synth FROM synth_baseline), 0))
      )::numeric AS mp
    FROM synth sy
  )
  SELECT u.mt, u.mp FROM (
    SELECT m.mt, m.mp FROM monthly m
    UNION ALL
    SELECT sp.mt, sp.mp FROM synth_priced sp
  ) u ORDER BY u.mt;
END
$function$;