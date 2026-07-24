
-- Grace-period + past_due support for is_pro / is_annual helpers.
-- Grants Pro during Stripe's retry window (past_due) and until current_period_end after cancel.

CREATE OR REPLACE FUNCTION public.is_pro_self()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.subscriptions
    WHERE user_id = auth.uid()
      AND tier IN ('pro_monthly','pro_annual')
      AND (
        (status IN ('active','trialing','past_due')
          AND (current_period_end IS NULL OR current_period_end > now()))
        OR (status = 'canceled' AND current_period_end > now())
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_pro(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _user_id
      AND tier IN ('pro_monthly','pro_annual')
      AND (
        (status IN ('active','trialing','past_due')
          AND (current_period_end IS NULL OR current_period_end > now()))
        OR (status = 'canceled' AND current_period_end > now())
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.is_annual_self()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.subscriptions
    WHERE user_id = auth.uid()
      AND tier = 'pro_annual'
      AND (
        (status IN ('active','trialing','past_due')
          AND (current_period_end IS NULL OR current_period_end > now()))
        OR (status = 'canceled' AND current_period_end > now())
      )
  )
$$;

-- Track first-activation for welcome toast/email (per user, first time tier flips to Pro).
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS pro_welcomed_at timestamptz;
