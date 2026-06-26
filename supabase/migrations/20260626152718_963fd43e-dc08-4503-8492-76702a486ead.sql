-- Broader backfill: also catch decade mentions ("2010s", "1990s", "'90s", "'00s")
UPDATE public.trends t
SET origin_year = sub.yr
FROM (
  SELECT id,
    COALESCE(
      -- Explicit 4-digit year
      ((regexp_match(origin, '(19[0-9]{2}|20[0-9]{2})'))[1])::int,
      -- Full decade like "2010s" or "1990s"
      CASE
        WHEN origin ~ '(19[0-9]0|20[0-9]0)s'
          THEN ((regexp_match(origin, '(19[0-9]0|20[0-9]0)s'))[1])::int
      END,
      -- Short decade like "'90s", "'00s", "'10s", "'20s"
      CASE
        WHEN origin ~ '''([0-9]0)s'
          THEN CASE
            WHEN ((regexp_match(origin, '''([0-9]0)s'))[1])::int >= 30
              THEN 1900 + ((regexp_match(origin, '''([0-9]0)s'))[1])::int
            ELSE 2000 + ((regexp_match(origin, '''([0-9]0)s'))[1])::int
          END
      END
    ) AS yr
  FROM public.trends
) sub
WHERE t.id = sub.id
  AND t.origin_year IS NULL
  AND sub.yr IS NOT NULL;

-- Reinforce the RPC fallback: explicit COALESCE chain with a final safety net
-- so the chart always anchors at a real timestamp, never NULL.
CREATE OR REPLACE FUNCTION public.get_trend_price_history(_trend_id uuid)
 RETURNS TABLE(t timestamp with time zone, price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH trend AS (
    SELECT
      base_price,
      COALESCE(
        -- 1) Known origin year from the trend's "Origin & context" section
        CASE WHEN origin_year IS NOT NULL
             THEN make_timestamptz(origin_year, 1, 1, 0, 0, 0)
        END,
        -- 2) Fallback: the year this trend was added to Trenslate
        date_trunc('year', created_at),
        -- 3) Final safety net: today (should never trigger)
        date_trunc('year', now())
      ) AS start_t
    FROM public.trends WHERE id = _trend_id
  ),
  events AS (
    SELECT created_at,
           CASE WHEN direction = 'up' THEN weight ELSE -weight END AS delta
    FROM public.votes
    WHERE trend_id = _trend_id
  ),
  series AS (
    SELECT (SELECT start_t FROM trend) AS t, 0::int AS delta
    UNION ALL
    SELECT created_at, delta FROM events
  )
  SELECT t,
         (SELECT base_price FROM trend) +
           SUM(delta) OVER (ORDER BY t ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::numeric AS price
  FROM series
  ORDER BY t
$function$;