
-- Aggregate trend "stock prices" without exposing per-user vote rows
CREATE OR REPLACE FUNCTION public.get_trend_scores()
RETURNS TABLE(
  trend_id uuid,
  slug text,
  term text,
  base_price numeric,
  net_votes bigint,
  price numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    t.id AS trend_id,
    t.slug,
    t.term,
    t.base_price,
    COALESCE(SUM(CASE WHEN v.direction = 'up' THEN v.weight ELSE -v.weight END), 0)::bigint AS net_votes,
    t.base_price + COALESCE(SUM(CASE WHEN v.direction = 'up' THEN v.weight ELSE -v.weight END), 0)::numeric AS price
  FROM public.trends t
  LEFT JOIN public.votes v ON v.trend_id = t.id
  GROUP BY t.id
  ORDER BY price DESC
$$;

GRANT EXECUTE ON FUNCTION public.get_trend_scores() TO anon, authenticated;

-- Make sure votes changes stream over realtime so the ticker can react instantly
ALTER TABLE public.votes REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'votes'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.votes';
  END IF;
END $$;
