
CREATE TABLE public.rate_limit_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  route TEXT NOT NULL,
  bucket TEXT NOT NULL,
  limit_max INTEGER NOT NULL,
  window_seconds INTEGER NOT NULL,
  retry_after INTEGER NOT NULL,
  ip TEXT,
  user_id UUID,
  key_hash TEXT,
  user_agent TEXT
);

GRANT ALL ON public.rate_limit_events TO service_role;
GRANT SELECT ON public.rate_limit_events TO authenticated;

ALTER TABLE public.rate_limit_events ENABLE ROW LEVEL SECURITY;

-- Only admins may read telemetry; writes come from the service-role
-- client inside enforceRateLimit (bypasses RLS by design).
CREATE POLICY "rate_limit_events admin read"
  ON public.rate_limit_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX rate_limit_events_created_idx
  ON public.rate_limit_events (created_at DESC);
CREATE INDEX rate_limit_events_route_bucket_idx
  ON public.rate_limit_events (route, bucket, created_at DESC);
CREATE INDEX rate_limit_events_ip_idx
  ON public.rate_limit_events (ip, created_at DESC)
  WHERE ip IS NOT NULL;
CREATE INDEX rate_limit_events_user_idx
  ON public.rate_limit_events (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

-- Housekeeping: trim rows older than 30 days.
CREATE OR REPLACE FUNCTION public.prune_rate_limit_events()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  WITH d AS (
    DELETE FROM public.rate_limit_events
     WHERE created_at < now() - interval '30 days'
     RETURNING 1
  ) SELECT count(*) INTO n FROM d;
  RETURN n;
END $$;
