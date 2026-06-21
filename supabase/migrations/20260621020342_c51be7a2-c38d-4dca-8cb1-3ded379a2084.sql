
CREATE POLICY "Authenticated can view recipe images"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'recipe-images');

CREATE POLICY "Authenticated can upload recipe images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'recipe-images');

CREATE POLICY "Authenticated can update recipe images"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'recipe-images');

CREATE POLICY "Authenticated can delete recipe images"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'recipe-images');
