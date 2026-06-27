CREATE OR REPLACE FUNCTION public.get_trend_price_history(_trend_id uuid)
 RETURNS TABLE(t timestamp with time zone, price numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_base numeric;
  v_start timestamptz;
  v_now timestamptz := date_trunc('month', now()) + interval '1 month' - interval '1 day';
  v_net numeric;
  v_seed bigint;
  v_months int;
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

  SELECT COALESCE(SUM(CASE WHEN direction='up' THEN weight ELSE -weight END),0)::numeric
  INTO v_net FROM public.votes WHERE trend_id = _trend_id;

  v_months := GREATEST(1, ((EXTRACT(YEAR FROM v_now)-EXTRACT(YEAR FROM v_start))*12
              + (EXTRACT(MONTH FROM v_now)-EXTRACT(MONTH FROM v_start)))::int);

  RETURN QUERY
  WITH months AS (
    SELECT generate_series(0, v_months) AS i
  ),
  curve AS (
    SELECT
      (v_start + (i || ' month')::interval) AS t,
      -- Popularity momentum: a hype curve that rises, peaks, then settles,
      -- modulated by deterministic per-trend seasonal noise so each term
      -- has its own "good months" and "slow months".
      (
        -- rising-and-fading hype envelope (0..1), peaks roughly 60% through life
        (
          CASE
            WHEN v_months = 0 THEN 1.0
            ELSE
              -- bell-ish curve centered at 0.6 with width ~0.35
              GREATEST(0.05, EXP( - POWER(((i::numeric / v_months) - 0.6) / 0.35, 2) ))
          END
        )
        -- seasonal swing unique to this trend
        * (1.0 + 0.55 * SIN( ((v_seed % 360)::numeric + i * (30 + (v_seed % 25))) * pi() / 180.0 ))
        -- secondary harmonic for variation
        * (1.0 + 0.25 * SIN( ((v_seed % 180)::numeric + i * (11 + (v_seed % 9))) * pi() / 90.0 ))
      ) AS shape
    FROM months
  ),
  scaled AS (
    SELECT t,
      v_base
      + shape * (GREATEST(ABS(v_net), 8) + v_base * 0.35)
      * SIGN(CASE WHEN v_net = 0 THEN 1 ELSE v_net END)
      AS price
    FROM curve
  )
  SELECT t, GREATEST(price, v_base * 0.15)::numeric AS price
  FROM scaled
  ORDER BY t;
END
$function$;