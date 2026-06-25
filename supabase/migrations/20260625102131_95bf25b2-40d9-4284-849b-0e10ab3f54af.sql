-- Allow admins to update trends (for editor)
CREATE POLICY "trends admin update" ON public.trends
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));