
CREATE TABLE public.productions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  recipe_id uuid NOT NULL,
  quantity_produced numeric NOT NULL,
  produced_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.production_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  production_id uuid NOT NULL REFERENCES public.productions(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL,
  ingredient_name text NOT NULL,
  quantity numeric NOT NULL,
  unit text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_productions_restaurant ON public.productions(restaurant_id, produced_at DESC);
CREATE INDEX idx_productions_recipe ON public.productions(recipe_id);
CREATE INDEX idx_production_items_production ON public.production_items(production_id);

ALTER TABLE public.productions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.production_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view productions" ON public.productions FOR SELECT TO authenticated
  USING (restaurant_id = current_restaurant_id());
CREATE POLICY "managers insert productions" ON public.productions FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers update productions" ON public.productions FOR UPDATE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers delete productions" ON public.productions FOR DELETE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE POLICY "members view production_items" ON public.production_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.productions p WHERE p.id = production_items.production_id AND p.restaurant_id = current_restaurant_id()));
CREATE POLICY "managers manage production_items" ON public.production_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.productions p WHERE p.id = production_items.production_id AND p.restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.productions p WHERE p.id = production_items.production_id AND p.restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid())));

CREATE TRIGGER set_updated_at_productions BEFORE UPDATE ON public.productions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
