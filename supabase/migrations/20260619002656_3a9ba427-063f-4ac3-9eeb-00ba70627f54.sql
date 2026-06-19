DROP POLICY IF EXISTS "view own profile or same restaurant" ON public.profiles;
CREATE POLICY "view own profile" ON public.profiles FOR SELECT USING (id = auth.uid());