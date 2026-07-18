
-- Tighten spotlight_pins INSERT to enforce created_by = auth.uid()
DROP POLICY IF EXISTS "Admins can insert spotlight pins" ON public.spotlight_pins;
CREATE POLICY "Admins can insert spotlight pins"
ON public.spotlight_pins
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) AND created_by = auth.uid());

-- Explicitly deny client writes on subscriptions (fail-closed hardening)
CREATE POLICY "subs no client insert" ON public.subscriptions FOR INSERT TO authenticated WITH CHECK (false);
CREATE POLICY "subs no client update" ON public.subscriptions FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
CREATE POLICY "subs no client delete" ON public.subscriptions FOR DELETE TO authenticated USING (false);
