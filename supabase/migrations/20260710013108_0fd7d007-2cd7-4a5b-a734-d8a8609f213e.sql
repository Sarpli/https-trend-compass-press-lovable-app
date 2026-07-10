
-- 1) is_annual_self helper for RLS
CREATE OR REPLACE FUNCTION public.is_annual_self()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.subscriptions
    WHERE user_id = auth.uid()
      AND tier = 'pro_annual'
      AND status = 'active'
      AND (current_period_end IS NULL OR current_period_end > now())
  )
$$;

-- 2) Tighten vote weight policies: weight=2 only for annual subscribers
DROP POLICY IF EXISTS "votes self insert" ON public.votes;
CREATE POLICY "votes self insert" ON public.votes
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      weight = 1
      OR (weight = 2 AND public.is_annual_self())
    )
    AND (
      category = ANY (ARRAY['week'::vote_category, 'month'::vote_category])
      OR public.is_pro_self()
    )
  );

DROP POLICY IF EXISTS "votes self update" ON public.votes;
CREATE POLICY "votes self update" ON public.votes
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      weight = 1
      OR (weight = 2 AND public.is_annual_self())
    )
    AND (
      category = ANY (ARRAY['week'::vote_category, 'month'::vote_category])
      OR public.is_pro_self()
    )
  );

-- 3) Attach profile-privileged-updates trigger
DROP TRIGGER IF EXISTS profiles_block_privileged_updates_trg ON public.profiles;
CREATE TRIGGER profiles_block_privileged_updates_trg
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_block_privileged_updates();

-- 4) Restrict vote_events public columns
REVOKE SELECT ON public.vote_events FROM anon, authenticated;
GRANT SELECT (id, trend_id, created_at, net_delta) ON public.vote_events TO anon, authenticated;

-- 5) Tighten chunk error insert policies (no more WITH CHECK true)
DROP POLICY IF EXISTS "Anyone can report chunk errors" ON public.chunk_errors;
CREATE POLICY "Anyone can report chunk errors" ON public.chunk_errors
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND COALESCE(length(message), 0) <= 4000
    AND COALESCE(length(user_agent), 0) <= 1000
    AND COALESCE(length(page_url), 0) <= 2000
    AND COALESCE(length(source_url), 0) <= 2000
  );

DROP POLICY IF EXISTS "Anyone can submit a report" ON public.chunk_error_reports;
CREATE POLICY "Anyone can submit a report" ON public.chunk_error_reports
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND COALESCE(length(message), 0) <= 4000
    AND COALESCE(length(user_agent), 0) <= 1000
    AND COALESCE(length(page_url), 0) <= 2000
    AND COALESCE(length(source_url), 0) <= 2000
  );

-- 6) Revoke EXECUTE on internal / trigger / admin functions
REVOKE EXECUTE ON FUNCTION public.broadcast_vote_event() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.bump_streak_on_search() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.chunk_errors_dedup() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.enforce_pro_for_premium_votes() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.profiles_block_privileged_updates() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.votes_block_field_mutation() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.check_perf_regressions() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.detect_pro_upgrade_intent_anomalies() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.prune_perf_events() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.prune_pro_upgrade_intents() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.prune_synthetic_pulse_history() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.tick_synthetic_pulses() FROM anon, authenticated, public;
