
-- Ad-hoc rate limiting primitive. Fixed-window counters keyed by
-- (bucket, key), reset each window. No client access needed — the
-- function runs SECURITY DEFINER and is called from server code only.

CREATE TABLE public.rate_limit_hits (
  bucket text NOT NULL,
  key text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, key, window_start)
);

GRANT ALL ON public.rate_limit_hits TO service_role;
ALTER TABLE public.rate_limit_hits ENABLE ROW LEVEL SECURITY;
-- No policies: table is only touched by the SECURITY DEFINER function below.

CREATE INDEX rate_limit_hits_window_idx
  ON public.rate_limit_hits (window_start);

-- Increments the counter for (bucket, key) in the current window. Returns
-- allowed=false and retry_after seconds when the caller has exceeded max.
CREATE OR REPLACE FUNCTION public.check_rate_limit(
  _bucket text,
  _key text,
  _max integer,
  _window_seconds integer
) RETURNS TABLE (allowed boolean, retry_after integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window_start timestamptz;
  v_count integer;
BEGIN
  IF _key IS NULL OR length(_key) = 0 THEN
    allowed := true; retry_after := 0; RETURN NEXT; RETURN;
  END IF;
  v_window_start := to_timestamp(
    (extract(epoch from now())::bigint / _window_seconds) * _window_seconds
  );

  INSERT INTO public.rate_limit_hits (bucket, key, window_start, count)
  VALUES (_bucket, _key, v_window_start, 1)
  ON CONFLICT (bucket, key, window_start)
    DO UPDATE SET count = public.rate_limit_hits.count + 1
  RETURNING count INTO v_count;

  IF v_count > _max THEN
    allowed := false;
    retry_after := GREATEST(
      1,
      _window_seconds - extract(epoch from (now() - v_window_start))::int
    );
  ELSE
    allowed := true;
    retry_after := 0;
  END IF;
  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO service_role;

-- Housekeeping: drop windows older than 1 hour.
CREATE OR REPLACE FUNCTION public.prune_rate_limit_hits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE n int;
BEGIN
  WITH d AS (
    DELETE FROM public.rate_limit_hits
     WHERE window_start < now() - interval '1 hour'
     RETURNING 1
  ) SELECT count(*) INTO n FROM d;
  RETURN n;
END $$;
