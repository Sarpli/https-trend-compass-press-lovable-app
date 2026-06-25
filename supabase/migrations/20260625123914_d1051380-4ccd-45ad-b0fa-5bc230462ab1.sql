
-- Allow admins to manage objects in the trend-images bucket
CREATE POLICY "Admins manage trend-images"
ON storage.objects FOR ALL
TO authenticated
USING (bucket_id = 'trend-images' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'trend-images' AND public.has_role(auth.uid(), 'admin'));
