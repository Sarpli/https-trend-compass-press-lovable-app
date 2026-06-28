ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS max_streak integer DEFAULT 0;

UPDATE public.profiles
SET max_streak = GREATEST(
  COALESCE(streak_count, 0),
  COALESCE((
    SELECT MAX(sh.new_streak_count)
    FROM public.streak_history sh
    WHERE sh.user_id = profiles.id
  ), 0)
);

CREATE OR REPLACE FUNCTION public.mark_trend_learned(_trend_id uuid, _local_date date)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_last date;
  v_count int;
  v_max int;
  v_new int;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.learned_trends(user_id, trend_id)
  VALUES (v_uid, _trend_id)
  ON CONFLICT DO NOTHING;

  SELECT last_active_local_date, COALESCE(streak_count, 0), COALESCE(max_streak, 0)
    INTO v_last, v_count, v_max
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
         max_streak = GREATEST(v_max, v_count, v_new),
         last_active_local_date = _local_date,
         last_active_date = _local_date
   WHERE id = v_uid;

  IF v_new > v_count THEN
    INSERT INTO public.streak_history(user_id, action_date, new_streak_count, source)
    VALUES (v_uid, _local_date, v_new, 'learned');
  END IF;

  RETURN v_new;
END
$$;

CREATE OR REPLACE FUNCTION public.bump_streak_on_search()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_today DATE := (NEW.created_at AT TIME ZONE 'UTC')::date;
  v_new_count int;
  v_old_count int;
BEGIN
  SELECT COALESCE(streak_count, 0) INTO v_old_count FROM public.profiles WHERE id = NEW.user_id;

  UPDATE public.profiles
     SET streak_count = CASE
           WHEN last_active_date = v_today - INTERVAL '1 day' THEN streak_count + 1
           ELSE 1
         END,
         max_streak = GREATEST(
           COALESCE(max_streak, 0),
           v_old_count,
           CASE
             WHEN last_active_date = v_today - INTERVAL '1 day' THEN streak_count + 1
             ELSE 1
           END
         ),
         last_active_date = v_today
   WHERE id = NEW.user_id
     AND (last_active_date IS DISTINCT FROM v_today)
  RETURNING streak_count INTO v_new_count;

  IF FOUND AND v_new_count > v_old_count THEN
    INSERT INTO public.streak_history(user_id, action_date, new_streak_count, source)
    VALUES (NEW.user_id, v_today, v_new_count, 'search');
  END IF;

  RETURN NEW;
END
$$;