-- 1) Attach the profiles privileged-column guard trigger.
DROP TRIGGER IF EXISTS profiles_block_privileged_updates_trg ON public.profiles;
CREATE TRIGGER profiles_block_privileged_updates_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_block_privileged_updates();

-- 2) Tighten perf_events insert policy so callers cannot spoof user_id.
DROP POLICY IF EXISTS perf_events_insert_any ON public.perf_events;
CREATE POLICY perf_events_insert_any
ON public.perf_events
FOR INSERT
WITH CHECK (
  (user_id IS NULL OR user_id = auth.uid())
  AND duration_ms >= 0::double precision
  AND duration_ms < 600000::double precision
  AND length(metric) BETWEEN 1 AND 64
  AND (route IS NULL OR length(route) <= 256)
);
