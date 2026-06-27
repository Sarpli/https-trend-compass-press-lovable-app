
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
  v_seed bigint;
  v_months int;
  v_total_net numeric;
BEGIN
  SELECT
    t.base_price,
    COALESCE(
      CASE WHEN t.origin_year IS NOT NULL
           THEN make_timestamptz(t.origin_year, 1, 1, 0, 0, 0)
      END,
      date_trunc('year', t.created_at),
      date_trunc('year', now())
    ),
    ('x' || substr(md5(t.id::text), 1, 12))::bit(48)::bigint
  INTO v_base, v_start, v_seed
  FROM public.trends t WHERE t.id = _trend_id;

  IF v_base IS NULL THEN RETURN; END IF;

  v_months := GREATEST(1, ((EXTRACT(YEAR FROM v_now)-EXTRACT(YEAR FROM v_start))*12
              + (EXTRACT(MONTH FROM v_now)-EXTRACT(MONTH FROM v_start)))::int);

  SELECT COALESCE(SUM(CASE WHEN direction='up' THEN weight ELSE -weight END),0)::numeric
  INTO v_total_net FROM public.votes WHERE trend_id = _trend_id;

  RETURN QUERY
  WITH months AS (
    SELECT generate_series(0, v_months) AS i,
           (v_start + (generate_series(0, v_months) || ' month')::interval) AS month_ts
  ),
  -- Real vote activity bucketed by month (net votes that month)
  vote_months AS (
    SELECT date_trunc('month', created_at) AS month_ts,
           SUM(CASE WHEN direction='up' THEN weight ELSE -weight END)::numeric AS net_delta
    FROM public.votes
    WHERE trend_id = _trend_id
    GROUP BY 1
  ),
  joined AS (
    SELECT m.i, m.month_ts,
           COALESCE(vm.net_delta, 0) AS net_delta
    FROM months m
    LEFT JOIN vote_months vm ON vm.month_ts = m.month_ts
  ),
  -- Cumulative real popularity from voters
  cum AS (
    SELECT i, month_ts,
           SUM(net_delta) OVER (ORDER BY i ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_net
    FROM joined
  ),
  shaped AS (
    SELECT
      month_ts AS t,
      -- Lifecycle hype envelope (bell-ish, peaks ~60% through lifespan)
      CASE
        WHEN v_months = 0 THEN 1.0
        ELSE GREATEST(0.08, EXP( - POWER(((i::numeric / v_months) - 0.6) / 0.32, 2) ))
      END
      -- Per-trend seasonal swing so each term has its own good/slow months
      * (1.0 + 0.35 * SIN( ((v_seed % 360)::numeric + i * (30 + (v_seed % 25))) * pi() / 180.0 ))
      AS shape,
      cum_net
    FROM cum
  )
  SELECT
    t,
    GREATEST(
      v_base * 0.2,
      v_base
        -- Real popularity contribution from actual votes over time
        + cum_net
        -- Hype/lifecycle shape, scaled so older popular terms still rise
        + shape * (v_base * 0.5 + GREATEST(ABS(v_total_net), 6) * 0.6)
          * SIGN(CASE WHEN v_total_net = 0 THEN 1 ELSE v_total_net END)
    )::numeric AS price
  FROM shaped
  ORDER BY t;
END
$function$;
