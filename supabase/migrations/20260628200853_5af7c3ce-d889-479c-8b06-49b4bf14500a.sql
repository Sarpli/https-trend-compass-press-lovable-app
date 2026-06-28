
-- learned_trends table
CREATE TABLE public.learned_trends (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trend_id uuid NOT NULL REFERENCES public.trends(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, trend_id)
);

GRANT SELECT, INSERT, DELETE ON public.learned_trends TO authenticated;
GRANT ALL ON public.learned_trends TO service_role;

ALTER TABLE public.learned_trends ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own learned" ON public.learned_trends
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users insert own learned" ON public.learned_trends
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users delete own learned" ON public.learned_trends
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- local-date streak tracking column
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_active_local_date date;

-- mark trend learned + bump streak (idempotent per local day)
CREATE OR REPLACE FUNCTION public.mark_trend_learned(_trend_id uuid, _local_date date)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_last date;
  v_count int;
  v_new int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.learned_trends(user_id, trend_id)
  VALUES (v_uid, _trend_id)
  ON CONFLICT DO NOTHING;

  SELECT last_active_local_date, COALESCE(streak_count, 0)
    INTO v_last, v_count
  FROM public.profiles WHERE id = v_uid FOR UPDATE;

  IF v_last = _local_date THEN
    v_new := v_count;
  ELSIF v_last = _local_date - 1 THEN
    v_new := v_count + 1;
  ELSE
    v_new := 1;
  END IF;

  UPDATE public.profiles
     SET streak_count = v_new,
         last_active_local_date = _local_date,
         last_active_date = _local_date
   WHERE id = v_uid;

  RETURN v_new;
END
$$;

GRANT EXECUTE ON FUNCTION public.mark_trend_learned(uuid, date) TO authenticated;

-- effective streak: returns 0 if user missed a day in their local TZ
CREATE OR REPLACE FUNCTION public.get_effective_streak(_local_date date)
RETURNS int
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_last date;
  v_count int;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;
  SELECT last_active_local_date, COALESCE(streak_count, 0)
    INTO v_last, v_count
  FROM public.profiles WHERE id = v_uid;
  IF v_last IS NULL THEN RETURN 0; END IF;
  IF v_last = _local_date OR v_last = _local_date - 1 THEN
    RETURN v_count;
  END IF;
  RETURN 0;
END
$$;

GRANT EXECUTE ON FUNCTION public.get_effective_streak(date) TO authenticated, anon;
