CREATE OR REPLACE FUNCTION public.bump_streak_on_search()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last DATE;
  v_today DATE := (NEW.created_at AT TIME ZONE 'UTC')::date;
BEGIN
  SELECT last_active_date INTO v_last FROM public.profiles WHERE id = NEW.user_id FOR UPDATE;
  IF v_last IS DISTINCT FROM v_today THEN
    UPDATE public.profiles
       SET streak_count = CASE
             WHEN v_last = v_today - INTERVAL '1 day' THEN streak_count + 1
             ELSE 1
           END,
           last_active_date = v_today
     WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS searches_bump_streak ON public.searches;
CREATE TRIGGER searches_bump_streak
AFTER INSERT ON public.searches
FOR EACH ROW EXECUTE FUNCTION public.bump_streak_on_search();