-- Extend purchase stock trigger to handle UPDATE and DELETE so editing/removing
-- a purchase correctly reverts and re-applies the stock delta.
CREATE OR REPLACE FUNCTION public.apply_purchase_to_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  old_qty numeric := 0;
  new_qty numeric := 0;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    old_qty := COALESCE(OLD.quantity, 0);
    UPDATE public.ingredients
      SET current_stock = COALESCE(current_stock, 0) - old_qty
      WHERE id = OLD.ingredient_id;
  END IF;

  IF TG_OP IN ('INSERT','UPDATE') THEN
    new_qty := COALESCE(NEW.quantity, 0);
    UPDATE public.ingredients
      SET current_stock = COALESCE(current_stock, 0) + new_qty,
          last_cost = COALESCE(NEW.unit_cost, last_cost)
      WHERE id = NEW.ingredient_id;
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$function$;

DROP TRIGGER IF EXISTS trg_apply_purchase_insert ON public.purchases;
DROP TRIGGER IF EXISTS trg_apply_purchase_to_stock ON public.purchases;
CREATE TRIGGER trg_apply_purchase_to_stock
AFTER INSERT OR UPDATE OR DELETE ON public.purchases
FOR EACH ROW EXECUTE FUNCTION public.apply_purchase_to_stock();

-- Allow managers to UPDATE purchases (previously only insert/delete were policed).
DROP POLICY IF EXISTS "managers update purchases" ON public.purchases;
CREATE POLICY "managers update purchases"
ON public.purchases
FOR UPDATE
TO authenticated
USING ((restaurant_id = current_restaurant_id()) AND is_manager_or_owner(auth.uid()));
