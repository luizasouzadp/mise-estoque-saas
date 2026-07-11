
create policy "invoices select own restaurant"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'purchase-invoices'
    and (storage.foldername(name))[1] = public.current_restaurant_id()::text
  );
create policy "invoices insert own restaurant"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'purchase-invoices'
    and (storage.foldername(name))[1] = public.current_restaurant_id()::text
  );
create policy "invoices delete own restaurant"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'purchase-invoices'
    and (storage.foldername(name))[1] = public.current_restaurant_id()::text
  );
