
CREATE TABLE public.pro_upgrade_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  trend_id uuid REFERENCES public.trends(id) ON DELETE SET NULL,
  category text NOT NULL,
  direction text,
  source text NOT NULL DEFAULT 'vote_trigger',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.pro_upgrade_intents TO authenticated;
GRANT ALL ON public.pro_upgrade_intents TO service_role;

ALTER TABLE public.pro_upgrade_intents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can log their own intent"
  ON public.pro_upgrade_intents FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can read intents"
  ON public.pro_upgrade_intents FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX pro_upgrade_intents_user_idx ON public.pro_upgrade_intents (user_id, created_at DESC);
CREATE INDEX pro_upgrade_intents_created_idx ON public.pro_upgrade_intents (created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_pro_for_premium_votes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.category IN ('year', 'oat') AND NOT public.is_pro_self() THEN
    INSERT INTO public.pro_upgrade_intents (user_id, trend_id, category, direction, source, metadata)
    VALUES (
      auth.uid(),
      NEW.trend_id,
      NEW.category::text,
      NEW.direction::text,
      'vote_trigger',
      jsonb_build_object('period_key', NEW.period_key, 'weight', NEW.weight)
    );
    RAISE EXCEPTION 'PRO_REQUIRED: Year and All-Time votes are reserved for Pro subscribers.'
      USING ERRCODE = '42501',
            HINT = 'Upgrade to Pro at /pricing to cast Year and All-Time votes.';
  END IF;
  IF NEW.weight NOT IN (1, 2) THEN
    RAISE EXCEPTION 'INVALID_WEIGHT: Vote weight must be 1 (Free/Pro) or 2 (Annual).'
      USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END
$function$;
