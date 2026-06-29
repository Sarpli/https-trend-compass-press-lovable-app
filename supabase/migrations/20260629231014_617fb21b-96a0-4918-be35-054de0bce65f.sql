
ALTER TABLE public.chunk_errors
  ADD COLUMN IF NOT EXISTS fingerprint text,
  ADD COLUMN IF NOT EXISTS client_id text;

CREATE INDEX IF NOT EXISTS chunk_errors_dedup_idx
  ON public.chunk_errors (fingerprint, build_version, COALESCE(user_id::text, client_id), created_at DESC);

CREATE OR REPLACE FUNCTION public.chunk_errors_dedup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor text := COALESCE(NEW.user_id::text, NEW.client_id);
BEGIN
  IF NEW.fingerprint IS NULL OR v_actor IS NULL THEN
    RETURN NEW;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.chunk_errors
     WHERE fingerprint = NEW.fingerprint
       AND build_version IS NOT DISTINCT FROM NEW.build_version
       AND COALESCE(user_id::text, client_id) = v_actor
       AND created_at > now() - interval '10 minutes'
  ) THEN
    RETURN NULL; -- silently drop the duplicate
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS chunk_errors_dedup_trg ON public.chunk_errors;
CREATE TRIGGER chunk_errors_dedup_trg
  BEFORE INSERT ON public.chunk_errors
  FOR EACH ROW EXECUTE FUNCTION public.chunk_errors_dedup();
