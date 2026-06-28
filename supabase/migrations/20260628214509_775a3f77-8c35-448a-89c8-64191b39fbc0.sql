ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS push_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS push_reminder_hour SMALLINT NOT NULL DEFAULT 20 CHECK (push_reminder_hour BETWEEN 0 AND 23);

ALTER TABLE public.profiles REPLICA IDENTITY FULL;

DO $$ BEGIN
  EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles';
EXCEPTION WHEN duplicate_object THEN NULL; WHEN others THEN NULL; END $$;