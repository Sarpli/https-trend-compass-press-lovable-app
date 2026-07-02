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
  v_net_week numeric;
  v_net_month numeric;
  v_net_year numeric;
  v_net_oat numeric;
  v_total_net numeric;
  v_pop_rank numeric;
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
    ('x' || substr(md5(tr.id::text), 1, 12))::bit(48)::bigint
  INTO v_base, v_start, v_seed
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

  SELECT
    COALESCE(SUM(CASE WHEN vv.category='week'  THEN CASE WHEN vv.direction='up' THEN vv.weight ELSE -vv.weight END END), 0),
    COALESCE(SUM(CASE WHEN vv.category='month' THEN CASE WHEN vv.direction='up' THEN vv.weight ELSE -vv.weight END END), 0),
    COALESCE(SUM(CASE WHEN vv.category='year'  THEN CASE WHEN vv.direction='up' THEN vv.weight ELSE -vv.weight END END), 0),
    COALESCE(SUM(CASE WHEN vv.category='oat'   THEN CASE WHEN vv.direction='up' THEN vv.weight ELSE -vv.weight END END), 0)
  INTO v_net_week, v_net_month, v_net_year, v_net_oat
  FROM public.votes vv WHERE vv.trend_id = _trend_id;

  v_total_net := COALESCE(v_net_week,0) + COALESCE(v_net_month,0)
               + COALESCE(v_net_year,0) + COALESCE(v_net_oat,0);

  SELECT COALESCE(pr, 0.5) INTO v_pop_rank FROM (
    SELECT PERCENT_RANK() OVER (ORDER BY n) AS pr, s.trend_id FROM (
      SELECT v.trend_id,
             SUM(CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END)::numeric AS n
      FROM public.votes v GROUP BY v.trend_id
    ) s
  ) r WHERE r.trend_id = _trend_id;

  v_drift := ((v_pop_rank - 0.45) * 0.030)
           + GREATEST(-0.010, LEAST(0.012, v_total_net * 0.0006));

  -- Per-term volatility: blend peak level, trajectory variance, popularity rank, and vote activity.
  -- Quiet terms hover near 0.06; spiky/viral terms can reach ~0.42.
  v_vol := 0.06
         + LEAST(0.18, COALESCE(v_peak, 50) / 100.0 * 0.22)          -- how tall the curve is
         + LEAST(0.12, COALESCE(v_pop_stddev, 0) / 100.0 * 0.35)     -- how choppy it is
         + LEAST(0.06, GREATEST(0, v_pop_rank - 0.4) * 0.15)         -- extra swing for above-median terms
         + LEAST(0.04, ABS(v_total_net) / 400.0 * 0.04);             -- extra swing from raw vote activity

  -- Per-term cycle periods, seeded so no two terms share the same rhythm.
  v_cycle_a := 5  + ((v_seed / 7)  % 11)::int;   -- 5..15 months
  v_cycle_b := 17 + ((v_seed / 13) % 19)::int;   -- 17..35 months
  v_cycle_c := 41 + ((v_seed / 29) % 23)::int;   -- 41..63 months

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
        -- Term-specific seasonal cycles (period + phase derived from the term's seed).
        + v_vol * 0.055 * SIN(((v_seed %  360)::numeric + i.i * (360.0 / v_cycle_a)) * pi() / 180.0)
        + v_vol * 0.038 * SIN(((v_seed %  720)::numeric + i.i * (360.0 / v_cycle_b)) * pi() / 180.0)
        + v_vol * 0.024 * SIN(((v_seed % 1080)::numeric + i.i * (360.0 / v_cycle_c)) * pi() / 180.0)
        -- Deterministic per-term noise (independent per month, unique per trend id).
        + v_vol * 0.070 * ((('x' || substr(md5(_trend_id::text || ':a:' || i.i::text), 1, 8))::bit(32)::bigint % 2000 - 1000) / 1000.0)
        + v_vol * 0.045 * ((('x' || substr(md5(_trend_id::text || ':b:' || i.i::text), 1, 8))::bit(32)::bigint % 2000 - 1000) / 1000.0)
        -- Occasional shock (frequency scales with volatility, so viral terms spike more often).
        + CASE
            WHEN (('x' || substr(md5(_trend_id::text || ':s:' || i.i::text), 1, 8))::bit(32)::bigint
                  % GREATEST(4, (14 - (v_vol * 30)::int))) = 0
            THEN v_vol * 0.140 * ((('x' || substr(md5(_trend_id::text || ':k:' || i.i::text), 1, 8))::bit(32)::bigint % 2000 - 1000) / 1000.0)
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
          GREATEST(v_base * 0.20,
            v_base * (0.50 + 0.012 *
              ((w.prev_v * w.next_age + w.next_v * w.prev_age) / (w.prev_age + w.next_age))
            ) * w.mult + 1.5 * COALESCE(w.cum_net, 0)
          )
        WHEN v_has_anchors AND COALESCE(w.prev_v, w.next_v) IS NOT NULL THEN
          GREATEST(v_base * 0.20,
            v_base * (0.50 + 0.012 * COALESCE(w.prev_v, w.next_v)) * w.mult + 1.5 * COALESCE(w.cum_net, 0)
          )
        ELSE
          GREATEST(v_base * 0.20, v_base * w.mult + 1.5 * COALESCE(w.cum_net, 0))
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
      GREATEST(v_base * 0.20,
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