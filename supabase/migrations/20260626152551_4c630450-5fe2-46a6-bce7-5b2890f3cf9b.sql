-- Add origin_year column to anchor each trend's price chart at the year it was created/popularized
ALTER TABLE public.trends ADD COLUMN IF NOT EXISTS origin_year integer;

-- Backfill: extract the earliest 4-digit year (1900-2099) mentioned in the origin text
UPDATE public.trends
SET origin_year = sub.yr::int
FROM (
  SELECT id,
         (regexp_match(origin, '(19[0-9]{2}|20[0-9]{2})'))[1] AS yr
  FROM public.trends
) sub
WHERE public.trends.id = sub.id
  AND sub.yr IS NOT NULL
  AND public.trends.origin_year IS NULL;

-- Update the price-history RPC to anchor at Jan 1 of origin_year when known,
-- otherwise fall back to the start of the year the row was created.
CREATE OR REPLACE FUNCTION public.get_trend_price_history(_trend_id uuid)
 RETURNS TABLE(t timestamp with time zone, price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH trend AS (
    SELECT base_price,
           COALESCE(
             make_timestamptz(origin_year, 1, 1, 0, 0, 0),
             date_trunc('year', created_at)
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