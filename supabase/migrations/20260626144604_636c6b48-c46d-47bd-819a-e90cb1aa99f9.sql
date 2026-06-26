
CREATE OR REPLACE FUNCTION public.get_category_vote_history(_category vote_category, _period_key text)
RETURNS TABLE(t timestamptz, score numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH events AS (
    SELECT created_at,
           CASE WHEN direction = 'up' THEN weight ELSE -weight END AS delta
    FROM public.votes
    WHERE category = _category AND period_key = _period_key
  )
  SELECT created_at AS t,
         SUM(delta) OVER (ORDER BY created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)::numeric AS score
  FROM events
  ORDER BY created_at
$$;

GRANT EXECUTE ON FUNCTION public.get_category_vote_history(vote_category, text) TO anon, authenticated, service_role;
