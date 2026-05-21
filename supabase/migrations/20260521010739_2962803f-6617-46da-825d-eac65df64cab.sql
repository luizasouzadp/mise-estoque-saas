CREATE OR REPLACE FUNCTION public.ingredient_avg_cost_last_30d(_ingredient_id uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_total_qty numeric;
  v_total_cost numeric;
  v_fallback numeric;
  v_src_recipe uuid;
BEGIN
  SELECT source_recipe_id INTO v_src_recipe FROM public.ingredients WHERE id = _ingredient_id;
  IF v_src_recipe IS NOT NULL THEN
    RETURN COALESCE(public.recipe_unit_cost(v_src_recipe), 0);
  END IF;

  SELECT COALESCE(SUM(p.quantity),0), COALESCE(SUM(p.total_cost),0)
    INTO v_total_qty, v_total_cost
  FROM public.purchases p
  WHERE p.ingredient_id = _ingredient_id
    AND p.purchased_at >= now() - interval '30 days';

  IF v_total_qty > 0 THEN
    RETURN v_total_cost / v_total_qty;
  END IF;

  SELECT COALESCE(SUM(p.quantity),0), COALESCE(SUM(p.total_cost),0)
    INTO v_total_qty, v_total_cost
  FROM public.purchases p
  WHERE p.ingredient_id = _ingredient_id;

  IF v_total_qty > 0 THEN
    RETURN v_total_cost / v_total_qty;
  END IF;

  SELECT COALESCE(NULLIF(i.avg_cost,0), NULLIF(i.last_cost,0), 0)
    INTO v_fallback
  FROM public.ingredients i
  WHERE i.id = _ingredient_id;

  RETURN COALESCE(v_fallback, 0);
END;
$function$;