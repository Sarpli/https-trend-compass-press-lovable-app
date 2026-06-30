
-- Performance: votes lookups by trend_id (used by get_trend_scores, price history, leaderboards)
CREATE INDEX IF NOT EXISTS votes_trend_id_idx ON public.votes (trend_id);
CREATE INDEX IF NOT EXISTS votes_trend_category_period_idx ON public.votes (trend_id, category, period_key);
CREATE INDEX IF NOT EXISTS vote_events_created_at_idx ON public.vote_events (created_at DESC);

-- Rewrite get_trend_scores: previously called get_trend_price_history(tr.id) for
-- EVERY row just to read the last price. That function generates a per-month
-- series with cum-sums and noise — astronomically expensive for a ticker that
-- only needs a rough popularity ordering. Replace with an inline proxy:
-- price = base_price + 1.5 * net_votes, which matches the dominant term of
-- the original formula and is what the ticker actually sorts by.
CREATE OR REPLACE FUNCTION public.get_trend_scores()
 RETURNS TABLE(trend_id uuid, slug text, term text, price numeric, net_votes numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH net AS (
    SELECT v.trend_id,
           SUM(CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END)::numeric AS n
    FROM public.votes v
    GROUP BY v.trend_id
  )
  SELECT tr.id AS trend_id,
         tr.slug,
         tr.term,
         (COALESCE(tr.base_price, 100) + 1.5 * COALESCE(n.n, 0))::numeric AS price,
         COALESCE(n.n, 0) AS net_votes
  FROM public.trends tr
  LEFT JOIN net n ON n.trend_id = tr.id;
$function$;

-- Prune vote_events older than 7 days so the realtime feed table doesn't bloat.
DELETE FROM public.vote_events WHERE created_at < now() - interval '7 days';
