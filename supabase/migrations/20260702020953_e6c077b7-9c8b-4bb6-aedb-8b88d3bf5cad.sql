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
        WHEN pop_pct >= 0.80 THEN 3.2
        WHEN pop_pct >= 0.30 THEN 1.8
        ELSE 0.8
      END AS magnitude,
      CASE
        WHEN pop_pct < 0.30 THEN 0.45
        ELSE 0.0
      END AS skip_prob,
      GREATEST(-1.0, LEAST(1.0, bias_raw / 20.0)) AS bias
    FROM ranked
  ),
  deltas AS (
    SELECT t.trend_id,
      CASE WHEN random() < t.skip_prob THEN 0::numeric
      ELSE GREATEST(-4.5, LEAST(4.5,
        t.magnitude
        * (0.65 + 0.35 * ABS(t.bias))
        * (random() * 2.0 - 1.0 + 0.45 * t.bias)
      ))
      END AS delta
    FROM tier t
  ),
  upserted AS (
    INSERT INTO public.synthetic_pulses (trend_id, synth_score, last_tick_at, updated_at)
    SELECT d.trend_id, d.delta, now(), now()
    FROM deltas d
    ON CONFLICT (trend_id) DO UPDATE
      SET synth_score = GREATEST(-25.0, LEAST(25.0,
            (GREATEST(-25.0, LEAST(25.0, public.synthetic_pulses.synth_score)) * 0.92)
            + EXCLUDED.synth_score
          )),
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

CREATE OR REPLACE FUNCTION public.get_trend_scores()
 RETURNS TABLE(trend_id uuid, slug text, term text, price numeric, net_votes numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH net AS (
    SELECT v.trend_id,
           SUM(CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END)::numeric AS n
    FROM public.votes v
    GROUP BY v.trend_id
  ),
  ranked AS (
    SELECT tr.id,
           PERCENT_RANK() OVER (ORDER BY COALESCE(n.n, 0)) AS pop_rank
    FROM public.trends tr
    LEFT JOIN net n ON n.trend_id = tr.id
  )
  SELECT tr.id AS trend_id,
         tr.slug,
         tr.term,
         GREATEST(
           COALESCE(tr.base_price, 100) * 0.35,
           LEAST(
             COALESCE(tr.base_price, 100) * 2.50,
             COALESCE(tr.base_price, 100)
             + GREATEST(-COALESCE(tr.base_price, 100) * 0.25, LEAST(COALESCE(tr.base_price, 100) * 0.35, 0.85 * COALESCE(n.n, 0)))
             + GREATEST(-COALESCE(tr.base_price, 100) * 0.08, LEAST(COALESCE(tr.base_price, 100) * 0.08, 0.65 * GREATEST(-25.0, LEAST(25.0, COALESCE(sp.synth_score, 0)))))
             + (COALESCE(r.pop_rank, 0.5) - 0.5) * COALESCE(tr.base_price, 100) * 0.12
           )
         )::numeric AS price,
         COALESCE(n.n, 0) AS net_votes
  FROM public.trends tr
  LEFT JOIN net n ON n.trend_id = tr.id
  LEFT JOIN ranked r ON r.id = tr.id
  LEFT JOIN public.synthetic_pulses sp ON sp.trend_id = tr.id;
$function$;

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
  v_seed bigint;
  v_anchor_start timestamptz;
  v_has_anchors bool;
  v_peak numeric;
  v_pop_stddev numeric;
  v_recent_net numeric;
  v_total_net numeric;
  v_pop_rank numeric;
  v_age_years numeric;
  v_newness numeric;
  v_cycle_a int;
  v_cycle_b int;
  v_cycle_c int;
  v_price_floor numeric;
  v_price_ceiling numeric;
BEGIN
  SELECT
    COALESCE(tr.base_price, 100),
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
         COALESCE(MAX(tp.intensity), 45),
         COALESCE(STDDEV_POP(tp.intensity), 0),
         EXISTS (SELECT 1 FROM public.trend_popularity tpx WHERE tpx.trend_id = _trend_id)
    INTO v_anchor_start, v_peak, v_pop_stddev, v_has_anchors
  FROM public.trend_popularity tp WHERE tp.trend_id = _trend_id;

  IF v_anchor_start IS NOT NULL AND v_anchor_start < v_start THEN
    v_start := v_anchor_start;
  END IF;

  v_months := GREATEST(1, ((EXTRACT(YEAR FROM v_now)-EXTRACT(YEAR FROM v_start))*12
              + (EXTRACT(MONTH FROM v_now)-EXTRACT(MONTH FROM v_start)))::int);

  SELECT COALESCE(SUM(CASE WHEN vv.direction='up' THEN vv.weight ELSE -vv.weight END), 0)
    INTO v_total_net
  FROM public.votes vv WHERE vv.trend_id = _trend_id;

  SELECT COALESCE(SUM(CASE WHEN vv.direction='up' THEN vv.weight ELSE -vv.weight END), 0)
    INTO v_recent_net
  FROM public.votes vv
  WHERE vv.trend_id = _trend_id AND vv.created_at > now() - interval '30 days';

  SELECT COALESCE(pr, 0.5) INTO v_pop_rank FROM (
    SELECT PERCENT_RANK() OVER (ORDER BY n) AS pr, s.trend_id FROM (
      SELECT tr.id AS trend_id,
             COALESCE(SUM(CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END), 0)::numeric AS n
      FROM public.trends tr
      LEFT JOIN public.votes v ON v.trend_id = tr.id
      GROUP BY tr.id
    ) s
  ) r WHERE r.trend_id = _trend_id;

  v_newness := GREATEST(0, LEAST(1, (7 - v_age_years) / 7.0));
  v_cycle_a := 4  + ((v_seed / 7)  % 9)::int;
  v_cycle_b := 11 + ((v_seed / 13) % 15)::int;
  v_cycle_c := 23 + ((v_seed / 29) % 19)::int;
  v_price_floor := v_base * 0.28;
  v_price_ceiling := v_base * CASE WHEN COALESCE(v_peak, 45) >= 90 THEN 2.25 ELSE 1.85 END;

  RETURN QUERY
  WITH months AS (
    SELECT g.i, (v_start + (g.i || ' month')::interval) AS month_ts
    FROM generate_series(0, v_months) AS g(i)
  ),
  anchors AS (
    SELECT tp.year, tp.month, tp.intensity::numeric,
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
  local_pop AS (
    SELECT i.month_ts, i.i,
      CASE
        WHEN v_has_anchors AND i.prev_v IS NOT NULL AND i.next_v IS NOT NULL AND (i.prev_age + i.next_age) > 0
          THEN (i.prev_v * i.next_age + i.next_v * i.prev_age) / (i.prev_age + i.next_age)
        WHEN v_has_anchors AND COALESCE(i.prev_v, i.next_v) IS NOT NULL
          THEN COALESCE(i.prev_v, i.next_v)
        ELSE GREATEST(18, LEAST(82,
          34
          + COALESCE(v_pop_rank, 0.5) * 22
          + v_newness * 14
          + TANH(COALESCE(v_total_net, 0) / 80.0) * 10
          + TANH(COALESCE(v_recent_net, 0) / 20.0) * 8
        ))
      END::numeric AS lp
    FROM interp i
  ),
  shaped AS (
    SELECT lp.month_ts, lp.i, lp.lp,
      COALESCE(LAG(lp.lp) OVER (ORDER BY lp.i), lp.lp) AS prev_lp,
      COALESCE(LEAD(lp.lp) OVER (ORDER BY lp.i), lp.lp) AS next_lp
    FROM local_pop lp
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
  priced AS (
    SELECT s.month_ts, s.i, s.lp, COALESCE(c.cum_net, 0) AS cum_net,
      GREATEST(-1.0, LEAST(1.0,
        TANH((s.next_lp - s.prev_lp) / 18.0) * 0.65
        + (COALESCE(v_pop_rank, 0.5) - 0.50) * 0.45
        + (v_newness - 0.50) * 0.35
        + TANH(COALESCE(v_recent_net, 0) / 35.0) * 0.25
        - CASE WHEN v_age_years >= 7 AND COALESCE(v_pop_rank, 0.5) < 0.58 THEN 0.35 ELSE 0 END
      )) AS dir_bias,
      -- Volatility is tied to THIS term's own popularity in THIS month.
      -- Quiet months move a little; peak/viral months swing visibly more.
      (0.030
        + POWER(GREATEST(0, s.lp) / 100.0, 1.35) * 0.105
        + LEAST(0.035, COALESCE(v_pop_stddev, 0) / 100.0 * 0.06)
      ) AS vol
    FROM shaped s
    JOIN cum c ON c.month_ts = s.month_ts
  ),
  monthly AS (
    SELECT p.month_ts AS mt,
      GREATEST(v_price_floor,
        LEAST(v_price_ceiling,
          (
            v_base * (0.58 + 1.06 * (p.lp / 100.0))
            + GREATEST(-v_base * 0.18, LEAST(v_base * 0.22, p.cum_net * 0.75))
          )
          * (1
            + p.vol * 0.55 * SIN(((v_seed % 360)::numeric + p.i * (360.0 / v_cycle_a)) * pi() / 180.0)
            + p.vol * 0.36 * SIN(((v_seed % 720)::numeric + p.i * (360.0 / v_cycle_b)) * pi() / 180.0)
            + p.vol * 0.24 * SIN(((v_seed % 1080)::numeric + p.i * (360.0 / v_cycle_c)) * pi() / 180.0)
            + p.vol * 0.46 * (((('x' || substr(md5(_trend_id::text || ':m:' || p.i::text), 1, 8))::bit(32)::bigint % 2000) - 1000) / 1000.0)
            + p.dir_bias * p.vol * 0.38
          )
        )
      )::numeric AS mp
    FROM priced p
  ),
  last_monthly AS (SELECT m.mp AS lp FROM monthly m ORDER BY m.mt DESC LIMIT 1),
  synth AS (
    SELECT sph.created_at AS st,
           GREATEST(-25.0, LEAST(25.0, sph.synth_score)) AS synth_score
    FROM public.synthetic_pulse_history sph
    WHERE sph.trend_id = _trend_id AND sph.created_at > now() - interval '7 days'
    ORDER BY sph.created_at
  ),
  synth_baseline AS (SELECT sy.synth_score AS base_synth FROM synth sy ORDER BY sy.st LIMIT 1),
  synth_priced AS (
    SELECT sy.st AS mt,
      GREATEST(v_price_floor,
        LEAST(v_price_ceiling,
          (SELECT lp FROM last_monthly)
          + GREATEST(-v_base * 0.08, LEAST(v_base * 0.08,
              (sy.synth_score - COALESCE((SELECT base_synth FROM synth_baseline), 0)) * v_base * 0.004
            ))
        )
      )::numeric AS mp
    FROM synth sy
  )
  SELECT u.mt, ROUND(u.mp, 2) FROM (
    SELECT m.mt, m.mp FROM monthly m
    UNION ALL
    SELECT sp.mt, sp.mp FROM synth_priced sp
  ) u ORDER BY u.mt;
END;
$function$;