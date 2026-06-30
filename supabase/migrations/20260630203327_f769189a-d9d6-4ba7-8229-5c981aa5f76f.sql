
-- 1) Reset exploited streak values
UPDATE public.profiles
   SET streak_count = LEAST(COALESCE(streak_count,0), 365),
       max_streak   = LEAST(COALESCE(max_streak,0), 365)
 WHERE streak_count > 10000 OR max_streak > 10000;

-- 2) Trigger to block users from writing protected columns on profiles
CREATE OR REPLACE FUNCTION public.profiles_block_privileged_updates()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_is_admin boolean := false;
BEGIN
  -- Service-role / SECURITY DEFINER callers have no auth.uid(); allow them.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_is_admin := public.has_role(auth.uid(), 'admin'::app_role);
  EXCEPTION WHEN OTHERS THEN
    v_is_admin := false;
  END;

  IF v_is_admin THEN
    RETURN NEW;
  END IF;

  -- Preserve privileged / server-managed columns from client writes.
  NEW.is_founding_voter      := OLD.is_founding_voter;
  NEW.push_enabled           := OLD.push_enabled;
  NEW.streak_count           := OLD.streak_count;
  NEW.max_streak             := OLD.max_streak;
  NEW.last_active_date       := OLD.last_active_date;
  NEW.last_active_local_date := OLD.last_active_local_date;
  -- Identity columns must never change via client UPDATE.
  NEW.id := OLD.id;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS profiles_block_privileged_updates ON public.profiles;
CREATE TRIGGER profiles_block_privileged_updates
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_block_privileged_updates();

-- 3) Trigger to lock vote immutable fields. Only `direction` may change after insert.
CREATE OR REPLACE FUNCTION public.votes_block_field_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW; -- service role / definer
  END IF;
  IF NEW.user_id    IS DISTINCT FROM OLD.user_id    THEN RAISE EXCEPTION 'vote user_id is immutable'    USING ERRCODE='42501'; END IF;
  IF NEW.trend_id   IS DISTINCT FROM OLD.trend_id   THEN RAISE EXCEPTION 'vote trend_id is immutable'   USING ERRCODE='42501'; END IF;
  IF NEW.category   IS DISTINCT FROM OLD.category   THEN RAISE EXCEPTION 'vote category is immutable'   USING ERRCODE='42501'; END IF;
  IF NEW.period_key IS DISTINCT FROM OLD.period_key THEN RAISE EXCEPTION 'vote period_key is immutable' USING ERRCODE='42501'; END IF;
  IF NEW.weight     IS DISTINCT FROM OLD.weight     THEN RAISE EXCEPTION 'vote weight is immutable'     USING ERRCODE='42501'; END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS votes_block_field_mutation ON public.votes;
CREATE TRIGGER votes_block_field_mutation
BEFORE UPDATE ON public.votes
FOR EACH ROW EXECUTE FUNCTION public.votes_block_field_mutation();
