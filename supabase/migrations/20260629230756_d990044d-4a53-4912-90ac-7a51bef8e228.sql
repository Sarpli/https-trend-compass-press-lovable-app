
CREATE TABLE public.chunk_errors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  build_version text,
  message text,
  source_url text,
  page_url text,
  user_agent text,
  user_id uuid
);

GRANT INSERT ON public.chunk_errors TO anon, authenticated;
GRANT SELECT ON public.chunk_errors TO authenticated;
GRANT ALL ON public.chunk_errors TO service_role;

ALTER TABLE public.chunk_errors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can report chunk errors"
  ON public.chunk_errors FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can read chunk errors"
  ON public.chunk_errors FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX chunk_errors_created_at_idx ON public.chunk_errors (created_at DESC);
CREATE INDEX chunk_errors_build_version_idx ON public.chunk_errors (build_version);
