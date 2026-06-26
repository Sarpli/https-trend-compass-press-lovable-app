
CREATE TABLE public.spotlight_pins (
  pin_date date NOT NULL PRIMARY KEY,
  trend_id uuid NOT NULL REFERENCES public.trends(id) ON DELETE CASCADE,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.spotlight_pins TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.spotlight_pins TO authenticated;
GRANT ALL ON public.spotlight_pins TO service_role;

ALTER TABLE public.spotlight_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read spotlight pins"
  ON public.spotlight_pins FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert spotlight pins"
  ON public.spotlight_pins FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update spotlight pins"
  ON public.spotlight_pins FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete spotlight pins"
  ON public.spotlight_pins FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
