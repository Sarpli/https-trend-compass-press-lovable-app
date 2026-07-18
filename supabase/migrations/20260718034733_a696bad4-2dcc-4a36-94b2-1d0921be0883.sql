
CREATE OR REPLACE FUNCTION public.mark_trend_learned(_trend_id uuid, _local_date date)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_last date;
  v_count int;
  v_max int;
  v_new int;
  v_utc_today date := (now() AT TIME ZONE 'UTC')::date;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- Clamp client-supplied local date to within ±1 day of the server's UTC
  -- date. This covers every real-world time-zone offset (UTC-12 … UTC+14)
  -- while blocking users who script future dates to inflate their streak.
  IF _local_date IS NULL
     OR _local_date < v_utc_today - 1
     OR _local_date > v_utc_today + 1 THEN
    RAISE EXCEPTION 'INVALID_LOCAL_DATE: local date % is outside the allowed window', _local_date
      USING ERRCODE = '22023';
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
$function$;

CREATE OR REPLACE FUNCTION public.get_effective_streak(_local_date date)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_last date;
  v_count int;
  v_utc_today date := (now() AT TIME ZONE 'UTC')::date;
  v_effective_date date := _local_date;
BEGIN
  IF v_uid IS NULL THEN RETURN 0; END IF;

  -- Clamp spoofed dates: if the client supplies something outside ±1 day
  -- of the server's UTC date, fall back to the server date instead of
  -- honoring the fabricated value.
  IF v_effective_date IS NULL
     OR v_effective_date < v_utc_today - 1
     OR v_effective_date > v_utc_today + 1 THEN
    v_effective_date := v_utc_today;
  END IF;

  SELECT last_active_local_date, COALESCE(streak_count, 0)
    INTO v_last, v_count
  FROM public.profiles WHERE id = v_uid;
  IF v_last IS NULL THEN RETURN 0; END IF;
  IF v_last = v_effective_date OR v_last = v_effective_date - 1 THEN
    RETURN v_count;
  END IF;
  RETURN 0;
END
$function$;
