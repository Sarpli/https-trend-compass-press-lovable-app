-- 1. Add popularity_history column to trends
ALTER TABLE public.trends
  ADD COLUMN IF NOT EXISTS popularity_history jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2. Seed historical popularity for every existing trend from real per-day vote counts
WITH bounds AS (
  SELECT
    t.id,
    GREATEST(
      LEAST(
        COALESCE(make_date(t.origin_year, 1, 1), t.created_at::date),
        t.created_at::date
      ),
      (CURRENT_DATE - INTERVAL '365 days')::date
    ) AS start_date,
    CURRENT_DATE AS end_date
  FROM public.trends t
),
days AS (
  SELECT b.id, gs::date AS day
  FROM bounds b,
       LATERAL generate_series(b.start_date::timestamp, b.end_date::timestamp, '1 day'::interval) gs
),
vote_counts AS (
  SELECT trend_id, created_at::date AS day, COUNT(*)::int AS cnt
  FROM public.votes
  GROUP BY trend_id, created_at::date
),
joined AS (
  SELECT d.id, d.day, COALESCE(vc.cnt, 0) AS cnt
  FROM days d
  LEFT JOIN vote_counts vc ON vc.trend_id = d.id AND vc.day = d.day
),
agg AS (
  SELECT id,
         jsonb_agg(jsonb_build_object('date', to_char(day, 'YYYY-MM-DD'), 'score', cnt) ORDER BY day) AS hist
  FROM joined
  GROUP BY id
)
UPDATE public.trends t
SET popularity_history = a.hist
FROM agg a
WHERE a.id = t.id;

-- 3. Daily cron: append today's vote count as today's score for each trend
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Unschedule any prior version (no-op if missing)
DO $$
BEGIN
  PERFORM cron.unschedule('append-daily-popularity');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'append-daily-popularity',
  '5 0 * * *', -- every day at 00:05 UTC
  $$
  WITH today_counts AS (
    SELECT trend_id, COUNT(*)::int AS cnt
    FROM public.votes
    WHERE created_at::date = CURRENT_DATE
    GROUP BY trend_id
  )
  UPDATE public.trends t
  SET popularity_history = COALESCE(t.popularity_history, '[]'::jsonb) || jsonb_build_array(
    jsonb_build_object(
      'date', to_char(CURRENT_DATE, 'YYYY-MM-DD'),
      'score', COALESCE((SELECT cnt FROM today_counts tc WHERE tc.trend_id = t.id), 0)
    )
  );
  $$
);
