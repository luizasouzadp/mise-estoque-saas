
-- Function: recompute avg_cost/last_cost for a single stocked recipe-ingredient
CREATE OR REPLACE FUNCTION public.refresh_stocked_ingredient_for_recipe(_recipe_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cost numeric;
BEGIN
  v_cost := COALESCE(public.recipe_unit_cost(_recipe_id), 0);
  UPDATE public.ingredients
     SET avg_cost = v_cost,
         last_cost = v_cost,
         updated_at = now()
   WHERE source_recipe_id = _recipe_id;
END;
$$;

-- Function: recompute ALL stocked recipe-ingredients (used when base costs change)
CREATE OR REPLACE FUNCTION public.refresh_all_stocked_ingredients()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id, source_recipe_id FROM public.ingredients WHERE source_recipe_id IS NOT NULL LOOP
    UPDATE public.ingredients
       SET avg_cost = COALESCE(public.recipe_unit_cost(r.source_recipe_id), 0),
           last_cost = COALESCE(public.recipe_unit_cost(r.source_recipe_id), 0),
           updated_at = now()
     WHERE id = r.id;
  END LOOP;
END;
$$;

-- Trigger on recipe_items: refresh that recipe's stocked ingredient
CREATE OR REPLACE FUNCTION public.trg_recipe_items_refresh_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_stocked_ingredient_for_recipe(OLD.recipe_id);
    RETURN OLD;
  ELSE
    PERFORM public.refresh_stocked_ingredient_for_recipe(NEW.recipe_id);
    IF TG_OP = 'UPDATE' AND OLD.recipe_id <> NEW.recipe_id THEN
      PERFORM public.refresh_stocked_ingredient_for_recipe(OLD.recipe_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS recipe_items_refresh_cost ON public.recipe_items;
CREATE TRIGGER recipe_items_refresh_cost
AFTER INSERT OR UPDATE OR DELETE ON public.recipe_items
FOR EACH ROW EXECUTE FUNCTION public.trg_recipe_items_refresh_cost();

-- Trigger on recipes: when yield changes, refresh stocked ingredient
CREATE OR REPLACE FUNCTION public.trg_recipes_refresh_cost()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (OLD.yield_qty IS DISTINCT FROM NEW.yield_qty) THEN
    PERFORM public.refresh_stocked_ingredient_for_recipe(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS recipes_refresh_cost ON public.recipes;
CREATE TRIGGER recipes_refresh_cost
AFTER UPDATE ON public.recipes
FOR EACH ROW EXECUTE FUNCTION public.trg_recipes_refresh_cost();

-- Trigger on purchases: refresh all stocked ingredients (base cost changed)
CREATE OR REPLACE FUNCTION public.trg_purchases_refresh_stocked()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_all_stocked_ingredients();
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS purchases_refresh_stocked ON public.purchases;
CREATE TRIGGER purchases_refresh_stocked
AFTER INSERT OR UPDATE OR DELETE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.trg_purchases_refresh_stocked();

-- Initial backfill
SELECT public.refresh_all_stocked_ingredients();
