-- Restrict profiles reads: previously any visitor could read every user's
-- timezone, push settings, streaks and last-active dates.
DROP POLICY IF EXISTS "profiles public read" ON public.profiles;

CREATE POLICY "profiles self read"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "profiles admin read"
ON public.profiles
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

REVOKE SELECT ON public.profiles FROM anon;