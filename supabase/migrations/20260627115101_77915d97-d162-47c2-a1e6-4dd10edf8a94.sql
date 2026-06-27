
CREATE OR REPLACE FUNCTION public.get_trend_scores()
 RETURNS TABLE(trend_id uuid, slug text, term text, base_price numeric, net_votes bigint, price numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH agg AS (
    SELECT
      t.id,
      t.slug,
      t.term,
      t.base_price,
      COALESCE(t.origin_year, EXTRACT(YEAR FROM t.created_at)::int) AS origin_year,
      COALESCE(SUM(CASE WHEN v.direction = 'up' THEN v.weight ELSE -v.weight END), 0)::bigint AS net_votes
    FROM public.trends t
    LEFT JOIN public.votes v ON v.trend_id = t.id
    GROUP BY t.id
  )
  SELECT
    id AS trend_id,
    slug,
    term,
    base_price,
    net_votes,
    -- Popularity = base + velocity (net votes per month since origin) scaled,
    -- with a small tail from cumulative votes so totals still matter.
    (
      base_price
      + (net_votes::numeric
          / GREATEST(
              EXTRACT(EPOCH FROM (now() - make_timestamptz(origin_year, 1, 1, 0, 0, 0))) / (60*60*24*30.0),
              1.0
            )
        ) * 12.0
      + net_votes::numeric * 0.1
    )::numeric AS price
  FROM agg
  ORDER BY price DESC
$function$;
