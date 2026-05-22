CREATE TABLE public.suppliers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  name text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, name)
);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view suppliers" ON public.suppliers
  FOR SELECT TO authenticated
  USING (restaurant_id = current_restaurant_id());

CREATE POLICY "managers insert suppliers" ON public.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE POLICY "managers update suppliers" ON public.suppliers
  FOR UPDATE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE POLICY "managers delete suppliers" ON public.suppliers
  FOR DELETE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE TRIGGER suppliers_set_updated_at
  BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();