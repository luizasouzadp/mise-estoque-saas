CREATE TABLE public.menu_products (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id uuid NOT NULL,
  name text NOT NULL,
  category text,
  current_price numeric,
  cost numeric NOT NULL DEFAULT 0,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.menu_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view menu_products" ON public.menu_products
  FOR SELECT TO authenticated
  USING (restaurant_id = current_restaurant_id());

CREATE POLICY "managers insert menu_products" ON public.menu_products
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE POLICY "managers update menu_products" ON public.menu_products
  FOR UPDATE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE POLICY "managers delete menu_products" ON public.menu_products
  FOR DELETE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE TRIGGER set_updated_at_menu_products
  BEFORE UPDATE ON public.menu_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();