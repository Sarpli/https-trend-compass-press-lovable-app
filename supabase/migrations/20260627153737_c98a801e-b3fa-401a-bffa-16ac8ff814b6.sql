CREATE TABLE IF NOT EXISTS public.trend_popularity (
  trend_id uuid NOT NULL REFERENCES public.trends(id) ON DELETE CASCADE,
  year int NOT NULL,
  month int NOT NULL CHECK (month BETWEEN 1 AND 12),
  intensity numeric NOT NULL CHECK (intensity >= 0 AND intensity <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trend_id, year, month)
);

GRANT SELECT ON public.trend_popularity TO anon, authenticated;
GRANT ALL ON public.trend_popularity TO service_role;

ALTER TABLE public.trend_popularity ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Popularity is publicly readable" ON public.trend_popularity;
CREATE POLICY "Popularity is publicly readable"
  ON public.trend_popularity FOR SELECT
  USING (true);

CREATE INDEX IF NOT EXISTS trend_popularity_trend_idx ON public.trend_popularity (trend_id, year, month);

CREATE OR REPLACE FUNCTION public.get_trend_price_history(_trend_id uuid)
RETURNS TABLE(t timestamptz, price numeric)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base numeric;
  v_start timestamptz;
  v_now timestamptz := date_trunc('month', now());
  v_months int;
  v_has_anchors bool;
  v_seed bigint;
  v_anchor_start timestamptz;
BEGIN
  SELECT
    tr.base_price,
    COALESCE(
      CASE WHEN tr.origin_year IS NOT NULL
           THEN make_timestamptz(tr.origin_year, 1, 1, 0, 0, 0)
      END,
      date_trunc('year', tr.created_at),
      date_trunc('year', now())
    ),
    ('x' || substr(md5(tr.id::text), 1, 12))::bit(48)::bigint
  INTO v_base, v_start, v_seed
  FROM public.trends tr WHERE tr.id = _trend_id;

  IF v_base IS NULL THEN RETURN; END IF;

  SELECT MIN(make_timestamptz(year, month, 1, 0, 0, 0))
    INTO v_anchor_start
  FROM public.trend_popularity WHERE trend_id = _trend_id;
  IF v_anchor_start IS NOT NULL AND v_anchor_start < v_start THEN
    v_start := v_anchor_start;
  END IF;

  v_months := GREATEST(1, ((EXTRACT(YEAR FROM v_now)-EXTRACT(YEAR FROM v_start))*12
              + (EXTRACT(MONTH FROM v_now)-EXTRACT(MONTH FROM v_start)))::int);

  SELECT EXISTS (SELECT 1 FROM public.trend_popularity WHERE trend_id = _trend_id) INTO v_has_anchors;

  RETURN QUERY
  WITH months AS (
    SELECT i, (v_start + (i || ' month')::interval) AS month_ts
    FROM generate_series(0, v_months) AS g(i)
  ),
  anchors AS (
    SELECT year, month, intensity,
           make_timestamptz(year, month, 1, 0, 0, 0) AS ts
    FROM public.trend_popularity
    WHERE trend_id = _trend_id
  ),
  interp AS (
    SELECT m.month_ts,
      (SELECT intensity FROM anchors a WHERE a.ts <= m.month_ts ORDER BY a.ts DESC LIMIT 1) AS prev_v,
      (SELECT EXTRACT(EPOCH FROM (m.month_ts - a.ts))/86400.0 FROM anchors a WHERE a.ts <= m.month_ts ORDER BY a.ts DESC LIMIT 1) AS prev_age,
      (SELECT intensity FROM anchors a WHERE a.ts >= m.month_ts ORDER BY a.ts ASC LIMIT 1) AS next_v,
      (SELECT EXTRACT(EPOCH FROM (a.ts - m.month_ts))/86400.0 FROM anchors a WHERE a.ts >= m.month_ts ORDER BY a.ts ASC LIMIT 1) AS next_age,
      m.i
    FROM months m
  ),
  vote_months AS (
    SELECT date_trunc('month', created_at) AS month_ts,
           SUM(CASE WHEN direction='up' THEN weight ELSE -weight END)::numeric AS net_delta
    FROM public.votes WHERE trend_id = _trend_id GROUP BY 1
  ),
  cum AS (
    SELECT m.month_ts,
      SUM(COALESCE(vm.net_delta,0)) OVER (ORDER BY m.month_ts ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum_net,
      m.i
    FROM months m LEFT JOIN vote_months vm ON vm.month_ts = m.month_ts
  ),
  shaped AS (
    SELECT i.month_ts,
      CASE
        WHEN v_has_anchors AND i.prev_v IS NOT NULL AND i.next_v IS NOT NULL AND (i.prev_age + i.next_age) > 0 THEN
          (i.prev_v * i.next_age + i.next_v * i.prev_age) / (i.prev_age + i.next_age)
        WHEN v_has_anchors AND i.prev_v IS NOT NULL THEN i.prev_v
        WHEN v_has_anchors AND i.next_v IS NOT NULL THEN i.next_v
        ELSE
          100.0 * GREATEST(0.08, EXP(- POWER(((i.i::numeric / NULLIF(v_months,0)) - 0.6)/0.32, 2)))
                * (1.0 + 0.30 * SIN(((v_seed % 360)::numeric + i.i * (28 + (v_seed % 27))) * pi() / 180.0))
      END AS intensity,
      c.cum_net
    FROM interp i JOIN cum c ON c.month_ts = i.month_ts
  )
  SELECT s.month_ts AS t,
    GREATEST(v_base * 0.25,
      v_base * (0.45 + 0.012 * s.intensity) + COALESCE(s.cum_net, 0)
    )::numeric AS price
  FROM shaped s
  ORDER BY s.month_ts;
END
$$;

INSERT INTO public.trend_popularity (trend_id, year, month, intensity)
SELECT t.id, v.year, v.month, v.intensity
FROM (VALUES
('hawk-tuah',2024,5,5),('hawk-tuah',2024,6,100),('hawk-tuah',2024,7,95),('hawk-tuah',2024,8,70),('hawk-tuah',2024,10,55),('hawk-tuah',2024,12,40),('hawk-tuah',2025,3,25),('hawk-tuah',2025,6,18),('hawk-tuah',2026,1,10),('hawk-tuah',2026,6,7),
('hawk-tuah-girl',2024,6,90),('hawk-tuah-girl',2024,7,100),('hawk-tuah-girl',2024,9,55),('hawk-tuah-girl',2024,12,30),('hawk-tuah-girl',2025,6,15),('hawk-tuah-girl',2026,1,8),
('grimace-shake',2023,5,10),('grimace-shake',2023,6,100),('grimace-shake',2023,7,75),('grimace-shake',2023,8,40),('grimace-shake',2023,10,20),('grimace-shake',2024,1,10),('grimace-shake',2025,1,5),
('gentleminions',2022,6,20),('gentleminions',2022,7,100),('gentleminions',2022,8,60),('gentleminions',2022,9,25),('gentleminions',2022,12,10),('gentleminions',2023,6,5),
('brat',2024,5,15),('brat',2024,6,80),('brat',2024,7,100),('brat',2024,8,95),('brat',2024,9,80),('brat',2024,10,70),('brat',2024,11,55),('brat',2024,12,45),('brat',2025,3,35),('brat',2025,8,25),('brat',2026,1,18),
('skibidi',2023,2,15),('skibidi',2023,5,45),('skibidi',2023,9,75),('skibidi',2023,12,90),('skibidi',2024,3,100),('skibidi',2024,6,90),('skibidi',2024,10,75),('skibidi',2025,3,55),('skibidi',2025,9,40),('skibidi',2026,3,30),
('skibidi-toilet',2023,2,20),('skibidi-toilet',2023,6,55),('skibidi-toilet',2023,10,85),('skibidi-toilet',2024,2,100),('skibidi-toilet',2024,8,80),('skibidi-toilet',2025,2,55),('skibidi-toilet',2025,12,35),
('rizz',2022,9,20),('rizz',2023,3,50),('rizz',2023,8,75),('rizz',2023,12,100),('rizz',2024,3,85),('rizz',2024,8,70),('rizz',2025,1,55),('rizz',2025,8,45),('rizz',2026,3,35),
('rizzler',2023,10,15),('rizzler',2023,12,55),('rizzler',2024,2,90),('rizzler',2024,4,100),('rizzler',2024,8,70),('rizzler',2024,12,45),('rizzler',2025,6,30),('rizzler',2026,1,20),
('moo-deng',2024,9,40),('moo-deng',2024,10,100),('moo-deng',2024,11,80),('moo-deng',2024,12,55),('moo-deng',2025,2,30),('moo-deng',2025,9,20),('moo-deng',2026,1,12),
('moo-deng-baby',2024,9,40),('moo-deng-baby',2024,10,100),('moo-deng-baby',2024,11,80),('moo-deng-baby',2024,12,55),('moo-deng-baby',2025,2,30),('moo-deng-baby',2025,9,20),('moo-deng-baby',2026,1,12),
('mob-wife',2024,1,55),('mob-wife',2024,2,100),('mob-wife',2024,3,75),('mob-wife',2024,4,45),('mob-wife',2024,8,25),('mob-wife',2024,12,18),('mob-wife',2025,6,12),
('mob-wife-winter',2024,1,55),('mob-wife-winter',2024,2,100),('mob-wife-winter',2024,3,75),('mob-wife-winter',2024,4,40),('mob-wife-winter',2024,12,20),('mob-wife-winter',2025,2,30),('mob-wife-winter',2026,1,15),
('demure-mindful',2024,7,15),('demure-mindful',2024,8,100),('demure-mindful',2024,9,80),('demure-mindful',2024,10,55),('demure-mindful',2024,12,30),('demure-mindful',2025,4,18),('demure-mindful',2026,1,10),
('very-mindful-very-demure',2024,7,15),('very-mindful-very-demure',2024,8,100),('very-mindful-very-demure',2024,9,80),('very-mindful-very-demure',2024,10,55),('very-mindful-very-demure',2024,12,30),('very-mindful-very-demure',2025,4,18),('very-mindful-very-demure',2026,1,10),
('demure',2024,7,15),('demure',2024,8,100),('demure',2024,9,80),('demure',2024,10,55),('demure',2024,12,30),('demure',2025,4,18),('demure',2026,1,10),
('six-seven',2024,11,10),('six-seven',2025,2,25),('six-seven',2025,5,55),('six-seven',2025,8,90),('six-seven',2025,10,100),('six-seven',2025,12,85),('six-seven',2026,3,65),('six-seven',2026,6,50),
('costco-guys',2024,4,20),('costco-guys',2024,7,75),('costco-guys',2024,9,100),('costco-guys',2024,11,80),('costco-guys',2025,2,50),('costco-guys',2025,8,30),('costco-guys',2026,1,20),
('brain-rot',2024,3,25),('brain-rot',2024,7,55),('brain-rot',2024,10,80),('brain-rot',2024,12,100),('brain-rot',2025,3,85),('brain-rot',2025,8,70),('brain-rot',2026,1,55),('brain-rot',2026,6,45),
('it-girl',1904,1,15),('it-girl',1955,1,30),('it-girl',1980,1,40),('it-girl',2000,1,55),('it-girl',2010,1,60),('it-girl',2014,1,75),('it-girl',2016,8,100),('it-girl',2020,1,70),('it-girl',2023,6,80),('it-girl',2024,6,75),
('chill-guy',2024,9,15),('chill-guy',2024,10,75),('chill-guy',2024,11,100),('chill-guy',2024,12,90),('chill-guy',2025,2,55),('chill-guy',2025,6,30),('chill-guy',2026,1,18),
('ballerina-cappuccina',2025,2,15),('ballerina-cappuccina',2025,3,55),('ballerina-cappuccina',2025,4,90),('ballerina-cappuccina',2025,5,100),('ballerina-cappuccina',2025,7,75),('ballerina-cappuccina',2025,10,45),('ballerina-cappuccina',2026,2,25),('ballerina-cappuccina',2026,6,18),
('fanum-tax',2022,9,20),('fanum-tax',2023,3,55),('fanum-tax',2023,9,90),('fanum-tax',2024,1,100),('fanum-tax',2024,6,75),('fanum-tax',2024,12,45),('fanum-tax',2025,6,25),('fanum-tax',2026,1,15),
('gyat',2022,10,25),('gyat',2023,4,60),('gyat',2023,9,95),('gyat',2024,1,100),('gyat',2024,6,80),('gyat',2024,12,55),('gyat',2025,6,35),('gyat',2026,1,22),
('aura',2024,3,20),('aura',2024,6,55),('aura',2024,9,90),('aura',2024,12,100),('aura',2025,4,80),('aura',2025,9,60),('aura',2026,3,45),
('delulu',2014,6,10),('delulu',2020,6,30),('delulu',2022,6,55),('delulu',2023,6,80),('delulu',2024,1,90),('delulu',2024,8,100),('delulu',2025,3,75),('delulu',2025,12,60),('delulu',2026,6,50),
('ohio',2016,6,10),('ohio',2020,6,25),('ohio',2022,6,55),('ohio',2023,6,90),('ohio',2023,12,100),('ohio',2024,6,80),('ohio',2025,2,55),('ohio',2026,1,35),
('gigachad',2017,6,15),('gigachad',2020,6,55),('gigachad',2021,6,80),('gigachad',2022,6,100),('gigachad',2023,6,85),('gigachad',2024,6,65),('gigachad',2025,6,45),('gigachad',2026,6,35),
('ick',2017,6,15),('ick',2019,6,30),('ick',2021,6,55),('ick',2023,6,90),('ick',2024,1,100),('ick',2024,8,80),('ick',2025,3,60),('ick',2026,1,45),
('girl-dinner',2023,6,30),('girl-dinner',2023,7,100),('girl-dinner',2023,8,75),('girl-dinner',2023,10,40),('girl-dinner',2024,3,20),('girl-dinner',2025,6,10),
('roman-empire',2023,8,25),('roman-empire',2023,9,100),('roman-empire',2023,10,85),('roman-empire',2023,12,50),('roman-empire',2024,4,25),('roman-empire',2024,12,15),('roman-empire',2025,6,10),
('girl-math',2023,7,20),('girl-math',2023,8,75),('girl-math',2023,9,100),('girl-math',2023,11,75),('girl-math',2024,3,45),('girl-math',2024,12,25),('girl-math',2025,6,15),
('boy-math',2023,9,25),('boy-math',2023,10,90),('boy-math',2023,11,100),('boy-math',2024,1,60),('boy-math',2024,6,30),('boy-math',2024,12,18),('boy-math',2025,6,12),
('quiet-quitting',2022,7,30),('quiet-quitting',2022,8,90),('quiet-quitting',2022,9,100),('quiet-quitting',2022,10,80),('quiet-quitting',2022,12,55),('quiet-quitting',2023,4,30),('quiet-quitting',2023,12,18),('quiet-quitting',2024,6,12),('quiet-quitting',2025,6,8),
('loud-budgeting',2024,1,40),('loud-budgeting',2024,2,100),('loud-budgeting',2024,3,80),('loud-budgeting',2024,5,50),('loud-budgeting',2024,9,30),('loud-budgeting',2025,1,40),('loud-budgeting',2025,6,25),('loud-budgeting',2026,1,18),
('mewing',2023,2,20),('mewing',2023,8,55),('mewing',2024,2,90),('mewing',2024,8,100),('mewing',2025,2,75),('mewing',2025,8,55),('mewing',2026,2,40),
('looksmaxxing',2022,6,15),('looksmaxxing',2023,8,40),('looksmaxxing',2024,2,75),('looksmaxxing',2024,8,100),('looksmaxxing',2025,2,80),('looksmaxxing',2025,8,60),('looksmaxxing',2026,2,45),
('sigma',2014,6,10),('sigma',2020,6,40),('sigma',2022,6,75),('sigma',2023,6,100),('sigma',2024,6,80),('sigma',2025,6,55),('sigma',2026,6,40),
('cheugy',2021,3,30),('cheugy',2021,4,100),('cheugy',2021,5,80),('cheugy',2021,7,55),('cheugy',2021,12,30),('cheugy',2022,6,18),('cheugy',2023,6,12),('cheugy',2024,6,8),
('side-eye-chloe',2013,10,30),('side-eye-chloe',2013,12,100),('side-eye-chloe',2014,3,70),('side-eye-chloe',2014,12,35),('side-eye-chloe',2016,6,20),('side-eye-chloe',2020,6,12),('side-eye-chloe',2024,6,8),
('tradwife',2018,6,20),('tradwife',2020,6,35),('tradwife',2022,6,55),('tradwife',2023,6,75),('tradwife',2024,3,100),('tradwife',2024,9,80),('tradwife',2025,3,65),('tradwife',2026,1,50),
('tomato-girl',2023,5,25),('tomato-girl',2023,7,100),('tomato-girl',2023,8,80),('tomato-girl',2023,9,55),('tomato-girl',2023,12,25),('tomato-girl',2024,6,15),('tomato-girl',2025,6,10),
('clean-girl',2022,3,25),('clean-girl',2022,8,75),('clean-girl',2023,3,100),('clean-girl',2023,9,80),('clean-girl',2024,3,55),('clean-girl',2024,12,35),('clean-girl',2025,6,22),
('coquette',2022,6,25),('coquette',2023,3,65),('coquette',2023,9,90),('coquette',2024,1,100),('coquette',2024,8,75),('coquette',2025,2,50),('coquette',2025,12,35),
('balletcore',2022,6,25),('balletcore',2022,12,65),('balletcore',2023,3,100),('balletcore',2023,9,75),('balletcore',2024,3,50),('balletcore',2024,12,30),('balletcore',2025,6,18),
('blokette',2024,3,20),('blokette',2024,5,75),('blokette',2024,7,100),('blokette',2024,9,70),('blokette',2025,1,40),('blokette',2025,7,25),('blokette',2026,1,15),
('tenniscore',2023,5,20),('tenniscore',2023,7,90),('tenniscore',2023,8,100),('tenniscore',2023,9,75),('tenniscore',2024,6,55),('tenniscore',2024,8,75),('tenniscore',2025,6,40),('tenniscore',2026,1,25),
('canon-event',2023,6,20),('canon-event',2023,7,55),('canon-event',2023,9,90),('canon-event',2023,11,100),('canon-event',2024,3,70),('canon-event',2024,9,45),('canon-event',2025,3,30),('canon-event',2025,12,20),
('beige-flag',2023,5,25),('beige-flag',2023,7,80),('beige-flag',2023,9,100),('beige-flag',2023,12,65),('beige-flag',2024,4,40),('beige-flag',2024,10,25),('beige-flag',2025,4,18),
('green-flag',2017,6,15),('green-flag',2020,6,35),('green-flag',2022,6,65),('green-flag',2023,6,90),('green-flag',2024,6,100),('green-flag',2025,6,80),('green-flag',2026,6,65),
('chat-is-this-real',2023,3,15),('chat-is-this-real',2023,8,55),('chat-is-this-real',2024,1,90),('chat-is-this-real',2024,6,100),('chat-is-this-real',2024,12,75),('chat-is-this-real',2025,6,55),('chat-is-this-real',2026,1,40),
('let-him-cook',2022,9,20),('let-him-cook',2023,3,55),('let-him-cook',2023,9,90),('let-him-cook',2024,3,100),('let-him-cook',2024,9,75),('let-him-cook',2025,3,55),('let-him-cook',2026,1,40),
('lock-in',2022,9,25),('lock-in',2023,3,55),('lock-in',2023,9,80),('lock-in',2024,3,100),('lock-in',2024,9,85),('lock-in',2025,3,70),('lock-in',2026,1,55),
('yap',2023,3,25),('yap',2023,9,65),('yap',2024,3,100),('yap',2024,9,80),('yap',2025,3,60),('yap',2026,1,45),
('glaze',2023,3,25),('glaze',2023,9,70),('glaze',2024,3,100),('glaze',2024,9,80),('glaze',2025,3,55),('glaze',2026,1,40),
('cooked',2023,3,20),('cooked',2023,9,55),('cooked',2024,3,90),('cooked',2024,9,100),('cooked',2025,3,75),('cooked',2026,1,55),
('chopped',2023,3,20),('chopped',2023,9,55),('chopped',2024,3,90),('chopped',2024,9,100),('chopped',2025,3,75),('chopped',2026,1,55),
('chopped-and-screwed',2023,3,20),('chopped-and-screwed',2023,9,55),('chopped-and-screwed',2024,3,90),('chopped-and-screwed',2024,9,100),('chopped-and-screwed',2025,3,75),('chopped-and-screwed',2026,1,55),
('crashout',2024,3,25),('crashout',2024,7,65),('crashout',2024,10,90),('crashout',2024,12,100),('crashout',2025,4,80),('crashout',2025,10,60),('crashout',2026,3,45),
('main-character',2020,7,35),('main-character',2020,9,100),('main-character',2021,3,75),('main-character',2022,3,55),('main-character',2023,3,40),('main-character',2024,3,30),('main-character',2025,3,22),
('soft-launch',2020,9,25),('soft-launch',2021,6,65),('soft-launch',2022,2,100),('soft-launch',2022,12,75),('soft-launch',2023,12,55),('soft-launch',2024,12,40),('soft-launch',2025,12,30),
('hard-launch',2020,9,25),('hard-launch',2021,9,65),('hard-launch',2022,9,100),('hard-launch',2023,9,80),('hard-launch',2024,9,60),('hard-launch',2025,9,45),
('situationship',2010,6,10),('situationship',2017,6,30),('situationship',2020,6,55),('situationship',2022,6,80),('situationship',2023,6,100),('situationship',2024,6,85),('situationship',2025,6,70),('situationship',2026,6,55),
('slay',1980,6,15),('slay',2000,6,30),('slay',2015,6,55),('slay',2019,6,80),('slay',2021,6,100),('slay',2023,6,80),('slay',2025,6,55),('slay',2026,6,40),
('bussin',2020,6,30),('bussin',2021,3,80),('bussin',2021,9,100),('bussin',2022,6,75),('bussin',2023,6,50),('bussin',2024,6,35),('bussin',2025,6,22),
('ate',2020,6,25),('ate',2021,6,55),('ate',2022,6,80),('ate',2023,6,100),('ate',2024,6,80),('ate',2025,6,55),('ate',2026,6,40),
('npc',2018,6,20),('npc',2020,6,40),('npc',2022,6,60),('npc',2023,9,100),('npc',2024,3,80),('npc',2024,12,55),('npc',2025,6,40),
('npc-streamer',2023,7,40),('npc-streamer',2023,9,100),('npc-streamer',2023,11,75),('npc-streamer',2024,3,45),('npc-streamer',2024,9,25),('npc-streamer',2025,6,15),
('based',2010,6,10),('based',2016,6,30),('based',2019,6,60),('based',2021,6,90),('based',2022,6,100),('based',2023,6,85),('based',2024,6,70),('based',2025,6,55),('based',2026,6,40),
('cap',2018,6,30),('cap',2019,6,75),('cap',2020,6,100),('cap',2021,6,90),('cap',2022,6,75),('cap',2023,6,55),('cap',2024,6,40),('cap',2025,6,28),
('cap-no-cap',2018,6,30),('cap-no-cap',2019,6,75),('cap-no-cap',2020,6,100),('cap-no-cap',2021,6,90),('cap-no-cap',2022,6,75),('cap-no-cap',2023,6,55),('cap-no-cap',2024,6,40),('cap-no-cap',2025,6,28),
('bet',2010,6,20),('bet',2018,6,55),('bet',2020,6,90),('bet',2022,6,100),('bet',2024,6,80),('bet',2026,6,55),
('bop',2010,6,15),('bop',2017,6,50),('bop',2020,6,90),('bop',2022,6,100),('bop',2024,6,80),('bop',2026,6,60),
('cringe',2010,6,30),('cringe',2016,6,75),('cringe',2019,6,100),('cringe',2022,6,85),('cringe',2024,6,65),('cringe',2026,6,50),
('highkey',2017,6,30),('highkey',2019,6,75),('highkey',2020,6,100),('highkey',2022,6,80),('highkey',2024,6,55),('highkey',2026,6,40),
('lowkey',2010,6,15),('lowkey',2017,6,55),('lowkey',2019,6,90),('lowkey',2020,6,100),('lowkey',2022,6,80),('lowkey',2024,6,55),('lowkey',2026,6,40),
('vibe-check',2019,6,30),('vibe-check',2019,11,100),('vibe-check',2020,6,75),('vibe-check',2021,6,50),('vibe-check',2023,6,30),('vibe-check',2025,6,20),
('opp',2012,6,25),('opp',2018,6,55),('opp',2020,6,80),('opp',2022,6,100),('opp',2024,6,80),('opp',2026,6,55),
('zaza',2018,6,20),('zaza',2020,6,55),('zaza',2022,6,90),('zaza',2023,6,100),('zaza',2024,6,85),('zaza',2025,6,65),('zaza',2026,6,50),
('goon',2020,6,20),('goon',2022,6,55),('goon',2023,6,80),('goon',2024,3,100),('goon',2024,9,85),('goon',2025,6,65),('goon',2026,3,50),
('edging',2023,3,30),('edging',2023,9,75),('edging',2024,3,100),('edging',2024,9,80),('edging',2025,3,55),('edging',2026,1,40),
('munching',2023,3,25),('munching',2023,9,70),('munching',2024,3,100),('munching',2024,9,75),('munching',2025,3,50),('munching',2026,1,35),
('pluh',2023,5,20),('pluh',2023,8,75),('pluh',2023,11,100),('pluh',2024,3,70),('pluh',2024,9,45),('pluh',2025,3,28),
('dupe',2022,3,20),('dupe',2022,9,55),('dupe',2023,3,80),('dupe',2023,9,100),('dupe',2024,3,85),('dupe',2024,9,70),('dupe',2025,3,55),('dupe',2026,1,45),
('era',2022,3,25),('era',2022,9,55),('era',2023,3,90),('era',2023,9,100),('era',2024,3,85),('era',2024,9,70),('era',2025,3,55),('era',2026,1,45),
('mid',2021,6,30),('mid',2022,6,75),('mid',2023,6,100),('mid',2024,6,85),('mid',2025,6,65),('mid',2026,6,50)
) AS v(slug, year, month, intensity)
JOIN public.trends t ON t.slug = v.slug
ON CONFLICT (trend_id, year, month) DO UPDATE SET intensity = EXCLUDED.intensity;