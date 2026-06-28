
-- Harden streak bump: same-day guard moved INTO the UPDATE's WHERE clause so
-- the check + write are a single atomic compare-and-set. Concurrent or retried
-- inserts for the same UTC day can never increment more than once.
CREATE OR REPLACE FUNCTION public.bump_streak_on_search()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today DATE := (NEW.created_at AT TIME ZONE 'UTC')::date;
BEGIN
  -- Atomic CAS: only one row update wins per (user, day). If
  -- last_active_date is already today, zero rows match and nothing happens.
  UPDATE public.profiles
     SET streak_count = CASE
           WHEN last_active_date = v_today - INTERVAL '1 day' THEN streak_count + 1
           ELSE 1
         END,
         last_active_date = v_today
   WHERE id = NEW.user_id
     AND (last_active_date IS DISTINCT FROM v_today);
  RETURN NEW;
END
$$;

-- Ensure exactly one trigger is attached, even if a prior version existed.
DROP TRIGGER IF EXISTS trg_bump_streak_on_search ON public.searches;
CREATE TRIGGER trg_bump_streak_on_search
AFTER INSERT ON public.searches
FOR EACH ROW
EXECUTE FUNCTION public.bump_streak_on_search();
