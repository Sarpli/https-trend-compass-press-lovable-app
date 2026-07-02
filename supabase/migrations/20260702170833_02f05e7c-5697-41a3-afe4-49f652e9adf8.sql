
CREATE TABLE public.trend_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trend_id uuid NOT NULL REFERENCES public.trends(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reason text NOT NULL CHECK (reason IN ('offensive','inaccurate','hate_speech','harassment','spam','other')),
  details text CHECK (details IS NULL OR char_length(details) <= 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','reviewing','resolved','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX trend_reports_status_idx ON public.trend_reports(status, created_at DESC);
CREATE INDEX trend_reports_trend_idx ON public.trend_reports(trend_id);

GRANT SELECT, INSERT ON public.trend_reports TO authenticated;
GRANT ALL ON public.trend_reports TO service_role;

ALTER TABLE public.trend_reports ENABLE ROW LEVEL SECURITY;

-- Authenticated users can file reports (one insert at a time; content is validated by check constraints).
CREATE POLICY "Authenticated users can file reports"
ON public.trend_reports
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = reporter_id);

-- Users can see their own reports; admins can see all.
CREATE POLICY "Users see own reports"
ON public.trend_reports
FOR SELECT TO authenticated
USING (auth.uid() = reporter_id OR public.has_role(auth.uid(), 'admin'));

-- Admins can update/delete reports (moderation).
CREATE POLICY "Admins moderate reports"
ON public.trend_reports
FOR UPDATE TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete reports"
ON public.trend_reports
FOR DELETE TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
