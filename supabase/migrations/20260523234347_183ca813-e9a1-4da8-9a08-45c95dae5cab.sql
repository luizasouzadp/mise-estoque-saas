
-- 1. Restrict profile updates so users can't change restaurant_id (tenant escape)
DROP POLICY IF EXISTS "update own profile" ON public.profiles;
CREATE POLICY "update own profile"
ON public.profiles
FOR UPDATE
USING (id = auth.uid())
WITH CHECK (id = auth.uid() AND restaurant_id = current_restaurant_id());

-- 2. Restrict viewing of phone numbers in inventory_schedules to managers/owners
DROP POLICY IF EXISTS "members view schedules" ON public.inventory_schedules;
CREATE POLICY "managers view schedules"
ON public.inventory_schedules
FOR SELECT
USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

-- 3. Fix mutable search_path on set_updated_at
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
begin new.updated_at = now(); return new; end;
$function$;

-- 4. Revoke EXECUTE on SECURITY DEFINER trigger/internal functions from anon and authenticated
REVOKE EXECUTE ON FUNCTION public.apply_purchase_to_stock() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.apply_stock_movement() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.trg_recipes_refresh_cost() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.trg_recipe_items_refresh_cost() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.trg_purchases_refresh_stocked() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.refresh_stocked_ingredient_for_recipe(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.refresh_all_stocked_ingredients() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.recipe_total_cost(uuid, integer) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.ingredient_avg_cost_last_30d(uuid) FROM anon, authenticated, public;

-- Keep recipe_unit_cost callable by authenticated (used as RPC from client) but not anon
REVOKE EXECUTE ON FUNCTION public.recipe_unit_cost(uuid) FROM anon, public;

-- has_role / current_restaurant_id / is_manager_or_owner are used in RLS — only need authenticated
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.current_restaurant_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_manager_or_owner(uuid) FROM anon, public;
