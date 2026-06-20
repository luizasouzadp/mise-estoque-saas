GRANT EXECUTE ON FUNCTION public.recipe_total_cost(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recipe_total_cost(uuid, integer) TO anon;
GRANT EXECUTE ON FUNCTION public.recipe_unit_cost(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.ingredient_avg_cost_last_30d(uuid) TO anon;