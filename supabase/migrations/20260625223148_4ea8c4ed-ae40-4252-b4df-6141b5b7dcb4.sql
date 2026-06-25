CREATE POLICY "Public read trend-images"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'trend-images');