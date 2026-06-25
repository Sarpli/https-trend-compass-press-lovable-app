
-- 1. Lock down profiles: revoke UPDATE on sensitive columns
REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (display_name) ON public.profiles TO authenticated;

-- 2. Cap vote weight via CHECK constraint
ALTER TABLE public.votes
  ADD CONSTRAINT votes_weight_check CHECK (weight IN (1, 2));

-- 3. New zero-arg is_pro() that uses auth.uid(); revoke probe-able version
CREATE OR REPLACE FUNCTION public.is_pro_self()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.subscriptions
    WHERE user_id = auth.uid()
      AND tier IN ('pro_monthly','pro_annual')
      AND status = 'active'
      AND (current_period_end IS NULL OR current_period_end > now())
  )
$$;

REVOKE EXECUTE ON FUNCTION public.is_pro(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_pro_self() TO authenticated;

-- 4. Replace votes RLS policies
DROP POLICY IF EXISTS "votes public read" ON public.votes;
DROP POLICY IF EXISTS "votes self insert" ON public.votes;
DROP POLICY IF EXISTS "votes self update" ON public.votes;
DROP POLICY IF EXISTS "votes self delete" ON public.votes;

CREATE POLICY "votes self read"
ON public.votes FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

CREATE POLICY "votes self insert"
ON public.votes FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND weight IN (1, 2)
  AND (
    category IN ('week','month')
    OR public.is_pro_self()
  )
);

CREATE POLICY "votes self update"
ON public.votes FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND weight IN (1, 2)
  AND (
    category IN ('week','month')
    OR public.is_pro_self()
  )
);

CREATE POLICY "votes self delete"
ON public.votes FOR DELETE
TO authenticated
USING (auth.uid() = user_id);

-- 5. Update glossary policy to use the safe is_pro_self()
DROP POLICY IF EXISTS "glossary self all" ON public.saved_glossary;
CREATE POLICY "glossary self all"
ON public.saved_glossary FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id AND public.is_pro_self());

-- 6. Public aggregate view of vote totals (no user_id)
CREATE OR REPLACE VIEW public.vote_tallies
WITH (security_invoker = true)
AS
SELECT
  trend_id,
  category,
  period_key,
  SUM(CASE WHEN direction = 'up' THEN weight ELSE -weight END)::int AS net_votes
FROM public.votes
GROUP BY trend_id, category, period_key;

-- The view bypasses votes RLS issue: SECURITY INVOKER means the caller's
-- access to the underlying votes table is enforced. So we need a way for
-- anon/authenticated to read aggregates without seeing rows. Use a
-- SECURITY DEFINER function instead.
DROP VIEW public.vote_tallies;

CREATE OR REPLACE FUNCTION public.get_vote_tallies(
  _category vote_category,
  _period_key text
)
RETURNS TABLE(trend_id uuid, net_votes int)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT trend_id,
         SUM(CASE WHEN direction = 'up' THEN weight ELSE -weight END)::int AS net_votes
  FROM public.votes
  WHERE category = _category AND period_key = _period_key
  GROUP BY trend_id
$$;

GRANT EXECUTE ON FUNCTION public.get_vote_tallies(vote_category, text) TO anon, authenticated;
