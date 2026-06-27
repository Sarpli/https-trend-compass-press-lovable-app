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

  -- Per-term volatility: hotter trends fluctuate more wildly. Range ~0.08 .. 0.32
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
          100.0 * GREATEST(0.08, EXP(- POWER(((i.i::numeric / NULLIF(v_months,0)) - 0.6)/0.32, 2)))
                * (1.0 + 0.30 * SIN(((v_seed % 360)::numeric + i.i * (28 + (v_seed % 27))) * pi() / 180.0))
      END AS intensity,
      c.cum_net,
      i.i
    FROM interp i JOIN cum c ON c.month_ts = i.month_ts
  ),
  -- Add layered stock-like fluctuations per term. Three sine waves at different
  -- frequencies (seeded per-trend so each term has its own rhythm) plus a
  -- deterministic pseudo-random jitter give every month a distinct wiggle.
  noisy AS (
    SELECT s.month_ts, s.intensity, s.cum_net,
      s.intensity * (
        1.0
        + v_vol * 0.55 * SIN(((v_seed % 360)::numeric + s.i * (11 + (v_seed % 13))) * pi() / 180.0)
        + v_vol * 0.35 * SIN(((v_seed % 720)::numeric + s.i * (29 + (v_seed % 19))) * pi() / 180.0)
        + v_vol * 0.22 * SIN(((v_seed % 1080)::numeric + s.i * (53 + (v_seed % 31))) * pi() / 180.0)
        + v_vol * 0.30 * ((('x' || substr(md5(_trend_id::text || s.i::text), 1, 8))::bit(32)::bigint % 2000 - 1000) / 1000.0)
      ) AS noisy_intensity
    FROM shaped s
  )
  SELECT n.month_ts AS t,
    GREATEST(v_base * 0.20,
      v_base * (0.45 + 0.012 * n.noisy_intensity) + COALESCE(n.cum_net, 0)
    )::numeric AS price
  FROM noisy n
  ORDER BY n.month_ts;
END
$function$;