
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
      COALESCE(
        CASE WHEN t.origin_year IS NOT NULL
             THEN make_timestamptz(t.origin_year, 1, 1, 0, 0, 0)
        END,
        date_trunc('year', t.created_at),
        date_trunc('year', now())
      ) AS v_start,
      ('x' || substr(md5(t.id::text), 1, 12))::bit(48)::bigint AS v_seed,
      COALESCE(SUM(CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END), 0)::numeric AS v_total_net
    FROM public.trends t
    LEFT JOIN public.votes v ON v.trend_id = t.id
    GROUP BY t.id
  ),
  shaped AS (
    SELECT
      id,
      slug,
      term,
      base_price,
      v_total_net,
      GREATEST(
        1,
        ((EXTRACT(YEAR FROM date_trunc('month', now())) - EXTRACT(YEAR FROM v_start)) * 12
         + (EXTRACT(MONTH FROM date_trunc('month', now())) - EXTRACT(MONTH FROM v_start)))::int
      ) AS v_months,
      v_seed
    FROM agg
  )
  SELECT
    id AS trend_id,
    slug,
    term,
    base_price,
    v_total_net::bigint AS net_votes,
    GREATEST(
      base_price * 0.2,
      base_price
        + v_total_net
        + (
            -- Lifecycle envelope evaluated at i = v_months (the "now" point)
            GREATEST(0.08, EXP( - POWER(((v_months::numeric / v_months) - 0.6) / 0.32, 2) ))
            * (1.0 + 0.35 * SIN( ((v_seed % 360)::numeric + v_months * (30 + (v_seed % 25))) * pi() / 180.0 ))
          )
          * (base_price * 0.5 + GREATEST(ABS(v_total_net), 6) * 0.6)
          * SIGN(CASE WHEN v_total_net = 0 THEN 1 ELSE v_total_net END)
    )::numeric AS price
  FROM shaped
  ORDER BY price DESC
$function$;
