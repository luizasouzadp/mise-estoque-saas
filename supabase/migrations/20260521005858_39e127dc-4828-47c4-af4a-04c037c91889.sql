-- Add is_stocked to recipes
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS is_stocked boolean NOT NULL DEFAULT false;

-- Add source_recipe_id to ingredients to link a stocked pre-prep ingredient to its recipe
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS source_recipe_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS ingredients_source_recipe_id_key ON public.ingredients(source_recipe_id) WHERE source_recipe_id IS NOT NULL;

-- Update cost function: 30d weighted avg -> all-time weighted avg -> last_cost/avg_cost; for recipe-linked ingredient, use recipe unit cost
CREATE OR REPLACE FUNCTION public.ingredient_avg_cost_last_30d(_ingredient_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  total_qty numeric;
  total_cost numeric;
  fallback numeric;
  src_recipe uuid;
BEGIN
  SELECT source_recipe_id INTO src_recipe FROM public.ingredients WHERE id = _ingredient_id;
  IF src_recipe IS NOT NULL THEN
    RETURN COALESCE(public.recipe_unit_cost(src_recipe), 0);
  END IF;

  SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(total_cost),0)
    INTO total_qty, total_cost
  FROM public.purchases
  WHERE ingredient_id = _ingredient_id
    AND purchased_at >= now() - interval '30 days';

  IF total_qty > 0 THEN
    RETURN total_cost / total_qty;
  END IF;

  -- fallback: all-time weighted average
  SELECT COALESCE(SUM(quantity),0), COALESCE(SUM(total_cost),0)
    INTO total_qty, total_cost
  FROM public.purchases
  WHERE ingredient_id = _ingredient_id;

  IF total_qty > 0 THEN
    RETURN total_cost / total_qty;
  END IF;

  SELECT COALESCE(NULLIF(avg_cost,0), NULLIF(last_cost,0), 0)
    INTO fallback
  FROM public.ingredients
  WHERE id = _ingredient_id;

  RETURN COALESCE(fallback, 0);
END;
$function$;