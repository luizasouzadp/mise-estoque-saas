
-- Recipes (fichas técnicas)
CREATE TABLE public.recipes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  yield_qty numeric NOT NULL DEFAULT 1,
  yield_unit text NOT NULL DEFAULT 'un',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.recipes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view recipes" ON public.recipes
  FOR SELECT TO authenticated
  USING (restaurant_id = current_restaurant_id());

CREATE POLICY "managers insert recipes" ON public.recipes
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE POLICY "managers update recipes" ON public.recipes
  FOR UPDATE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE POLICY "managers delete recipes" ON public.recipes
  FOR DELETE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE TRIGGER recipes_set_updated_at
  BEFORE UPDATE ON public.recipes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Recipe items: an item is either an ingredient or another recipe (sub-recipe)
CREATE TABLE public.recipe_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipe_id uuid NOT NULL REFERENCES public.recipes(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('ingredient','recipe')),
  ingredient_id uuid,
  sub_recipe_id uuid REFERENCES public.recipes(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'un',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (item_type = 'ingredient' AND ingredient_id IS NOT NULL AND sub_recipe_id IS NULL) OR
    (item_type = 'recipe' AND sub_recipe_id IS NOT NULL AND ingredient_id IS NULL)
  )
);

CREATE INDEX idx_recipe_items_recipe ON public.recipe_items(recipe_id);

ALTER TABLE public.recipe_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view recipe_items" ON public.recipe_items
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = recipe_items.recipe_id AND r.restaurant_id = current_restaurant_id()));

CREATE POLICY "managers manage recipe_items" ON public.recipe_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = recipe_items.recipe_id AND r.restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = recipe_items.recipe_id AND r.restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid())));

-- Weighted average cost of an ingredient based on purchases in last 30 days
CREATE OR REPLACE FUNCTION public.ingredient_avg_cost_last_30d(_ingredient_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_qty numeric;
  total_cost numeric;
  fallback numeric;
BEGIN
  SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(total_cost),0)
    INTO total_qty, total_cost
  FROM public.purchases
  WHERE ingredient_id = _ingredient_id
    AND purchased_at >= now() - interval '30 days';

  IF total_qty > 0 THEN
    RETURN total_cost / total_qty;
  END IF;

  SELECT COALESCE(NULLIF(last_cost,0), avg_cost, 0)
    INTO fallback
  FROM public.ingredients
  WHERE id = _ingredient_id;

  RETURN COALESCE(fallback, 0);
END;
$$;

-- Total cost of a recipe (recursive through sub-recipes)
CREATE OR REPLACE FUNCTION public.recipe_total_cost(_recipe_id uuid, _depth int DEFAULT 0)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total numeric := 0;
  it record;
  sub_yield numeric;
  sub_cost numeric;
BEGIN
  IF _depth > 10 THEN
    RETURN 0;
  END IF;

  FOR it IN SELECT * FROM public.recipe_items WHERE recipe_id = _recipe_id LOOP
    IF it.item_type = 'ingredient' THEN
      total := total + COALESCE(it.quantity,0) * public.ingredient_avg_cost_last_30d(it.ingredient_id);
    ELSIF it.item_type = 'recipe' THEN
      SELECT COALESCE(yield_qty,1) INTO sub_yield FROM public.recipes WHERE id = it.sub_recipe_id;
      sub_cost := public.recipe_total_cost(it.sub_recipe_id, _depth + 1);
      IF sub_yield > 0 THEN
        total := total + COALESCE(it.quantity,0) * (sub_cost / sub_yield);
      END IF;
    END IF;
  END LOOP;

  RETURN total;
END;
$$;

CREATE OR REPLACE FUNCTION public.recipe_unit_cost(_recipe_id uuid)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  y numeric;
  t numeric;
BEGIN
  SELECT COALESCE(yield_qty,1) INTO y FROM public.recipes WHERE id = _recipe_id;
  t := public.recipe_total_cost(_recipe_id, 0);
  IF y > 0 THEN RETURN t / y; ELSE RETURN 0; END IF;
END;
$$;
