
-- 1) Table
CREATE TABLE IF NOT EXISTS public.synthetic_pulses (
  trend_id      uuid PRIMARY KEY REFERENCES public.trends(id) ON DELETE CASCADE,
  synth_score   numeric NOT NULL DEFAULT 0,
  last_tick_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.synthetic_pulses TO anon, authenticated;
GRANT ALL ON public.synthetic_pulses TO service_role;

ALTER TABLE public.synthetic_pulses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "synthetic_pulses public read" ON public.synthetic_pulses;
CREATE POLICY "synthetic_pulses public read"
  ON public.synthetic_pulses FOR SELECT
  TO anon, authenticated
  USING (true);

-- 2) Tick function
CREATE OR REPLACE FUNCTION public.tick_synthetic_pulses()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH recent AS (
    SELECT
      tr.id AS trend_id,
      COALESCE(SUM(
        CASE
          WHEN v.created_at > now() - interval '1 hour'
            THEN (CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END) * 3
          WHEN v.created_at > now() - interval '24 hours'
            THEN (CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END)
          ELSE 0
        END
      ), 0)::numeric AS bias_raw,
      COALESCE(SUM(CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END), 0)::numeric AS total_net
    FROM public.trends tr
    LEFT JOIN public.votes v ON v.trend_id = tr.id
    GROUP BY tr.id
  ),
  ranked AS (
    SELECT trend_id, bias_raw, total_net,
           PERCENT_RANK() OVER (ORDER BY total_net) AS pop_pct
    FROM recent
  ),
  tier AS (
    SELECT trend_id, bias_raw, total_net, pop_pct,
      CASE
        WHEN pop_pct >= 0.80 THEN 6.0   -- hot
        WHEN pop_pct >= 0.30 THEN 3.0   -- warm
        ELSE 1.0                         -- cold
      END AS magnitude,
      CASE
        WHEN pop_pct < 0.30 THEN 0.6     -- cold often ticks zero
        ELSE 0.0
      END AS skip_prob,
      GREATEST(-1.0, LEAST(1.0, bias_raw / 20.0)) AS bias
    FROM ranked
  ),
  deltas AS (
    SELECT t.trend_id,
      CASE WHEN random() < t.skip_prob THEN 0::numeric
      ELSE GREATEST(-8.0, LEAST(8.0,
        t.magnitude
        * (0.55 + 0.45 * t.bias)
        * (random() * 2.0 - 1.0 + 0.6 * t.bias)
      ))
      END AS delta
    FROM tier t
  ),
  upserted AS (
    INSERT INTO public.synthetic_pulses (trend_id, synth_score, last_tick_at, updated_at)
    SELECT d.trend_id, d.delta, now(), now()
    FROM deltas d
    ON CONFLICT (trend_id) DO UPDATE
      SET synth_score = (public.synthetic_pulses.synth_score * 0.985) + EXCLUDED.synth_score,
          last_tick_at = now(),
          updated_at = now()
    RETURNING trend_id, synth_score
  ),
  ev AS (
    INSERT INTO public.vote_events (trend_id)
    SELECT d.trend_id FROM deltas d WHERE d.delta <> 0
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upserted;

  RETURN v_count;
END;
$$;

-- 3) Update get_trend_scores to include synthetic component
CREATE OR REPLACE FUNCTION public.get_trend_scores()
RETURNS TABLE(trend_id uuid, slug text, term text, price numeric, net_votes numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH net AS (
    SELECT v.trend_id,
           SUM(CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END)::numeric AS n
    FROM public.votes v
    GROUP BY v.trend_id
  )
  SELECT tr.id AS trend_id,
         tr.slug,
         tr.term,
         (COALESCE(tr.base_price, 100)
           + 1.5 * COALESCE(n.n, 0)
           + 1.0 * COALESCE(sp.synth_score, 0)
         )::numeric AS price,
         COALESCE(n.n, 0) AS net_votes
  FROM public.trends tr
  LEFT JOIN net n ON n.trend_id = tr.id
  LEFT JOIN public.synthetic_pulses sp ON sp.trend_id = tr.id;
$$;
