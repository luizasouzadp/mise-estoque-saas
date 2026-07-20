
CREATE TABLE public.purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL,
  supplier_name text,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  quantity numeric NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  expected_at date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','received','cancelled')),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_purchase_orders_restaurant_status ON public.purchase_orders(restaurant_id, status);
CREATE INDEX idx_purchase_orders_supplier ON public.purchase_orders(supplier_id);
CREATE INDEX idx_purchase_orders_ingredient ON public.purchase_orders(ingredient_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_orders TO authenticated;
GRANT ALL ON public.purchase_orders TO service_role;

ALTER TABLE public.purchase_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view purchase_orders" ON public.purchase_orders
  FOR SELECT TO authenticated
  USING (restaurant_id = public.current_restaurant_id());

CREATE POLICY "members insert purchase_orders" ON public.purchase_orders
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = public.current_restaurant_id());

CREATE POLICY "members update purchase_orders" ON public.purchase_orders
  FOR UPDATE TO authenticated
  USING (restaurant_id = public.current_restaurant_id())
  WITH CHECK (restaurant_id = public.current_restaurant_id());

CREATE POLICY "managers delete purchase_orders" ON public.purchase_orders
  FOR DELETE TO authenticated
  USING (restaurant_id = public.current_restaurant_id() AND public.is_manager_or_owner(auth.uid()));

CREATE TRIGGER purchase_orders_set_updated_at
  BEFORE UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
