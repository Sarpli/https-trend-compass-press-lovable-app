CREATE TABLE public.dismissed_banners (
    user_id uuid NOT NULL,
    trend_id uuid NOT NULL REFERENCES public.trends(id) ON DELETE CASCADE,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, trend_id)
);

GRANT SELECT, INSERT, DELETE ON public.dismissed_banners TO authenticated;
GRANT ALL ON public.dismissed_banners TO service_role;

ALTER TABLE public.dismissed_banners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own dismissed banners"
ON public.dismissed_banners
FOR ALL
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);