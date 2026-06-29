CREATE TABLE public.chunk_error_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  client_id text,
  route text,
  page_url text,
  message text,
  source_url text,
  build_version text,
  retry_attempt int NOT NULL DEFAULT 0,
  last_toast_state text,
  user_agent text,
  online boolean
);

GRANT INSERT ON public.chunk_error_reports TO anon, authenticated;
GRANT SELECT ON public.chunk_error_reports TO authenticated;
GRANT ALL ON public.chunk_error_reports TO service_role;

ALTER TABLE public.chunk_error_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can submit a report"
  ON public.chunk_error_reports FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

CREATE POLICY "Admins can read reports"
  ON public.chunk_error_reports FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX chunk_error_reports_created_at_idx
  ON public.chunk_error_reports (created_at DESC);