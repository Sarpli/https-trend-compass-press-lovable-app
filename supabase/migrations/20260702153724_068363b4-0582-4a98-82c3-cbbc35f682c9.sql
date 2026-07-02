ALTER TABLE public.vote_events
  ADD COLUMN IF NOT EXISTS category public.vote_category,
  ADD COLUMN IF NOT EXISTS direction public.vote_direction,
  ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS net_delta numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS event_type text NOT NULL DEFAULT 'unknown';

DO $$
BEGIN
  ALTER TABLE public.vote_events
    ADD CONSTRAINT vote_events_event_type_check
    CHECK (event_type IN ('insert', 'update', 'delete', 'synthetic', 'unknown'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.broadcast_vote_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  old_signed numeric := 0;
  new_signed numeric := 0;
BEGIN
  IF TG_OP = 'INSERT' THEN
    new_signed := CASE WHEN NEW.direction = 'up' THEN NEW.weight ELSE -NEW.weight END;
    INSERT INTO public.vote_events (trend_id, category, direction, weight, net_delta, event_type)
    VALUES (NEW.trend_id, NEW.category, NEW.direction, NEW.weight, new_signed, 'insert');
    RETURN NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    old_signed := CASE WHEN OLD.direction = 'up' THEN OLD.weight ELSE -OLD.weight END;
    new_signed := CASE WHEN NEW.direction = 'up' THEN NEW.weight ELSE -NEW.weight END;
    INSERT INTO public.vote_events (trend_id, category, direction, weight, net_delta, event_type)
    VALUES (NEW.trend_id, NEW.category, NEW.direction, NEW.weight, new_signed - old_signed, 'update');
    RETURN NULL;
  ELSIF TG_OP = 'DELETE' THEN
    old_signed := CASE WHEN OLD.direction = 'up' THEN OLD.weight ELSE -OLD.weight END;
    INSERT INTO public.vote_events (trend_id, category, direction, weight, net_delta, event_type)
    VALUES (OLD.trend_id, OLD.category, OLD.direction, OLD.weight, -old_signed, 'delete');
    RETURN NULL;
  END IF;

  RETURN NULL;
END $$;