
-- Enums
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.sub_tier AS ENUM ('free', 'pro_monthly', 'pro_annual');
CREATE TYPE public.vote_category AS ENUM ('week', 'month', 'year', 'oat');
CREATE TYPE public.vote_direction AS ENUM ('up', 'down');

-- updated_at helper
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  streak_count INT NOT NULL DEFAULT 0,
  last_active_date DATE,
  is_founding_voter BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT ON public.profiles TO anon;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles public read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- subscriptions
CREATE TABLE public.subscriptions (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tier public.sub_tier NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sub self read" ON public.subscriptions FOR SELECT USING (auth.uid() = user_id);

-- user_roles
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE(user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "roles self read" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- helper: is user pro?
CREATE OR REPLACE FUNCTION public.is_pro(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _user_id
      AND tier IN ('pro_monthly','pro_annual')
      AND status = 'active'
      AND (current_period_end IS NULL OR current_period_end > now())
  )
$$;

CREATE OR REPLACE FUNCTION public.is_annual(_user_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS(
    SELECT 1 FROM public.subscriptions
    WHERE user_id = _user_id AND tier = 'pro_annual' AND status = 'active'
  )
$$;

-- trends
CREATE TABLE public.trends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  term TEXT NOT NULL,
  plain_language TEXT NOT NULL,
  origin TEXT NOT NULL,
  safety_tips TEXT NOT NULL,
  examples JSONB NOT NULL DEFAULT '[]'::jsonb,
  category TEXT,
  base_price NUMERIC NOT NULL DEFAULT 100,
  featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.trends TO anon, authenticated;
GRANT ALL ON public.trends TO service_role;
ALTER TABLE public.trends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "trends public read" ON public.trends FOR SELECT USING (true);

-- votes
CREATE TABLE public.votes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trend_id UUID NOT NULL REFERENCES public.trends(id) ON DELETE CASCADE,
  category public.vote_category NOT NULL,
  direction public.vote_direction NOT NULL,
  weight INT NOT NULL DEFAULT 1,
  period_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, trend_id, category, period_key)
);
GRANT SELECT ON public.votes TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.votes TO authenticated;
GRANT ALL ON public.votes TO service_role;
ALTER TABLE public.votes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "votes public read" ON public.votes FOR SELECT USING (true);
CREATE POLICY "votes self insert" ON public.votes FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND (
    category IN ('week','month')
    OR public.is_pro(auth.uid())
  )
);
CREATE POLICY "votes self update" ON public.votes FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "votes self delete" ON public.votes FOR DELETE USING (auth.uid() = user_id);

-- saved glossary (pro)
CREATE TABLE public.saved_glossary (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trend_id UUID NOT NULL REFERENCES public.trends(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, trend_id)
);
GRANT SELECT, INSERT, DELETE ON public.saved_glossary TO authenticated;
GRANT ALL ON public.saved_glossary TO service_role;
ALTER TABLE public.saved_glossary ENABLE ROW LEVEL SECURITY;
CREATE POLICY "glossary self all" ON public.saved_glossary FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND public.is_pro(auth.uid()));

-- searches (for quota)
CREATE TABLE public.searches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  query TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX searches_user_day ON public.searches (user_id, created_at);
GRANT SELECT, INSERT ON public.searches TO authenticated;
GRANT ALL ON public.searches TO service_role;
ALTER TABLE public.searches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "searches self all" ON public.searches FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- handle_new_user trigger -> profile + free sub
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.subscriptions (user_id, tier) VALUES (NEW.id, 'free');
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');
  RETURN NEW;
END $$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- vote score view (live "price" = base + net votes weighted, all-time)
CREATE OR REPLACE VIEW public.trend_scores AS
SELECT
  t.id AS trend_id,
  t.slug,
  t.term,
  t.base_price,
  COALESCE(SUM(CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END), 0) AS net_votes,
  t.base_price + COALESCE(SUM(CASE WHEN v.direction='up' THEN v.weight ELSE -v.weight END), 0) AS price
FROM public.trends t
LEFT JOIN public.votes v ON v.trend_id = t.id
GROUP BY t.id;
GRANT SELECT ON public.trend_scores TO anon, authenticated;

-- realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.votes;
