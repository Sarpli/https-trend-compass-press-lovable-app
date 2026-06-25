
CREATE TABLE IF NOT EXISTS public.vote_events (
  id BIGSERIAL PRIMARY KEY,
  trend_id UUID NOT NULL REFERENCES public.trends(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.vote_events TO anon, authenticated;
GRANT ALL ON public.vote_events TO service_role;

ALTER TABLE public.vote_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "vote_events public read" ON public.vote_events;
CREATE POLICY "vote_events public read"
ON public.vote_events FOR SELECT
TO anon, authenticated
USING (true);

CREATE OR REPLACE FUNCTION public.broadcast_vote_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.vote_events (trend_id)
  VALUES (COALESCE(NEW.trend_id, OLD.trend_id));
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS votes_broadcast ON public.votes;
CREATE TRIGGER votes_broadcast
AFTER INSERT OR UPDATE OR DELETE ON public.votes
FOR EACH ROW EXECUTE FUNCTION public.broadcast_vote_event();

ALTER PUBLICATION supabase_realtime ADD TABLE public.vote_events;
