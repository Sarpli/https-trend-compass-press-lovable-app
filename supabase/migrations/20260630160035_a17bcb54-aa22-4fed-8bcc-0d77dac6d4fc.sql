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
  v_tilt numeric;        -- late-life slope from recent (week+month) activity
  v_floor_boost numeric; -- raises the plateau floor for evergreen OAT favorites
  v_recent_kick numeric; -- final-month kick from this week's votes
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

  -- Per-category net votes. Each category captures a different horizon:
  --   week  = right-now momentum    → final-month kick
  --   month = recent staying power  → late-life upward tilt
  --   year  = sustained interest    → mid-plateau lift
  --   oat   = all-time canon status → raises the floor so it can't dip
  SELECT
    COALESCE(SUM(CASE WHEN category='week'  THEN CASE WHEN direction='up' THEN weight ELSE -weight END END), 0),
    COALESCE(SUM(CASE WHEN category='month' THEN CASE WHEN direction='up' THEN weight ELSE -weight END END), 0),
    COALESCE(SUM(CASE WHEN category='year'  THEN CASE WHEN direction='up' THEN weight ELSE -weight END END), 0),
    COALESCE(SUM(CASE WHEN category='oat'   THEN CASE WHEN direction='up' THEN weight ELSE -weight END END), 0)
  INTO v_net_week, v_net_month, v_net_year, v_net_oat
  FROM public.votes WHERE trend_id = _trend_id;

  -- Late-life tilt: dominated by month + week (recent behavior), with a small
  -- year contribution. Bounded so a single brigade can't flip the chart.
  v_tilt := GREATEST(-0.30, LEAST(0.65,
              (v_net_month * 0.022) + (v_net_week * 0.030) + (v_net_year * 0.008)
            ));

  -- OAT votes act like a status floor: an all-time-great term should never
  -- look dead, even years after it peaked. Positive OAT raises the floor;
  -- negative OAT lets it sag a little.
  v_floor_boost := GREATEST(-0.10, LEAST(0.45, v_net_oat * 0.012));

  -- Tiny extra bump on the final month proportional to this week's net votes.
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
          -- Sigmoid rise → plateau (no forced decline).
          -- Floor is lifted by OAT votes so canon terms keep a healthy baseline.
          -- Late-life tilt comes from week+month vote sentiment.
          -- A small final-month kick reflects this week's momentum.
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
  )
  SELECT n.month_ts AS t,
    GREATEST(v_base * 0.20,
      v_base * (0.45 + 0.012 * n.noisy_intensity) + (1.5 * COALESCE(n.cum_net, 0))
    )::numeric AS price
  FROM noisy n
  ORDER BY n.month_ts;
END
$function$;