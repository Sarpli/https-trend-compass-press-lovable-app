
CREATE OR REPLACE FUNCTION public.get_trend_price_history(_trend_id uuid)
 RETURNS TABLE(t timestamp with time zone, price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH trend AS (
    SELECT base_price, date_trunc('year', created_at) AS start_t
    FROM public.trends WHERE id = _trend_id
  ),
  events AS (
    SELECT created_at,
           CASE WHEN direction = 'up' THEN weight ELSE -weight END AS delta
    FROM public.votes
    WHERE trend_id = _trend_id
  ),
  series AS (
    -- Anchor at the start of the year the trend was created
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
