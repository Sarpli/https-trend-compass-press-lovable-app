CREATE OR REPLACE FUNCTION public.get_trend_scores()
 RETURNS TABLE(trend_id uuid, slug text, term text, price numeric, net_votes numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH net AS (
    SELECT v.trend_id,
      SUM(CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END)::numeric AS n
    FROM public.votes v GROUP BY v.trend_id
  )
  SELECT tr.id AS trend_id, tr.slug, tr.term,
    (SELECT h.price FROM public.get_trend_price_history(tr.id) h ORDER BY h.t DESC LIMIT 1) AS price,
    COALESCE(n.n, 0) AS net_votes
  FROM public.trends tr
  LEFT JOIN net n ON n.trend_id = tr.id;
END
$function$;