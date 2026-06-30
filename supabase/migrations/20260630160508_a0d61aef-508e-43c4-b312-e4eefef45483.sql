CREATE OR REPLACE FUNCTION public.enforce_pro_for_premium_votes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.category IN ('year', 'oat') AND NOT public.is_pro_self() THEN
    RAISE EXCEPTION 'PRO_REQUIRED: Year and All-Time votes are reserved for Pro subscribers.'
      USING ERRCODE = '42501',
            HINT = 'Upgrade to Pro at /pricing to cast Year and All-Time votes.';
  END IF;
  IF NEW.weight NOT IN (1, 2) THEN
    RAISE EXCEPTION 'INVALID_WEIGHT: Vote weight must be 1 (Free/Pro) or 2 (Annual).'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS votes_enforce_pro_insert ON public.votes;
DROP TRIGGER IF EXISTS votes_enforce_pro_update ON public.votes;

CREATE TRIGGER votes_enforce_pro_insert
  BEFORE INSERT ON public.votes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_pro_for_premium_votes();

CREATE TRIGGER votes_enforce_pro_update
  BEFORE UPDATE ON public.votes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_pro_for_premium_votes();