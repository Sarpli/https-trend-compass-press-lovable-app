
CREATE OR REPLACE FUNCTION public.get_trend_price_history(_trend_id uuid)
RETURNS TABLE(t timestamptz, price numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH base AS (
    SELECT base_price FROM public.trends WHERE id = _trend_id
  ),
  events AS (
    SELECT created_at,
           CASE WHEN direction = 'up' THEN weight ELSE -weight END AS delta
    FROM public.votes
    WHERE trend_id = _trend_id
    ORDER BY created_at
  )
  SELECT created_at AS t,
         (SELECT base_price FROM base) + SUM(delta) OVER (ORDER BY created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS price
  FROM events
$$;

GRANT EXECUTE ON FUNCTION public.get_trend_price_history(uuid) TO anon, authenticated;
