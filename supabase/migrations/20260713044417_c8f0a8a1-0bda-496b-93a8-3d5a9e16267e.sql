
-- 1) Junction table: ingredient x supplier (many-to-many)
CREATE TABLE public.ingredient_suppliers (
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (ingredient_id, supplier_id)
);

CREATE INDEX idx_ing_sup_ingredient ON public.ingredient_suppliers(ingredient_id);
CREATE INDEX idx_ing_sup_supplier ON public.ingredient_suppliers(supplier_id);
CREATE UNIQUE INDEX ing_sup_one_primary
  ON public.ingredient_suppliers(ingredient_id) WHERE is_primary;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.ingredient_suppliers TO authenticated;
GRANT ALL ON public.ingredient_suppliers TO service_role;

ALTER TABLE public.ingredient_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view ingredient_suppliers" ON public.ingredient_suppliers
  FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "managers insert ingredient_suppliers" ON public.ingredient_suppliers
  FOR INSERT WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers update ingredient_suppliers" ON public.ingredient_suppliers
  FOR UPDATE USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers delete ingredient_suppliers" ON public.ingredient_suppliers
  FOR DELETE USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

-- 2) Backfill from existing default_supplier_id
INSERT INTO public.ingredient_suppliers (ingredient_id, supplier_id, restaurant_id, is_primary)
SELECT i.id, i.default_supplier_id, i.restaurant_id, true
FROM public.ingredients i
WHERE i.default_supplier_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- 3) Keep ingredients.default_supplier_id in sync with is_primary
CREATE OR REPLACE FUNCTION public.sync_ingredient_default_supplier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- ensure only one primary per ingredient
  UPDATE public.ingredient_suppliers
    SET is_primary = false
    WHERE ingredient_id = NEW.ingredient_id
      AND supplier_id <> NEW.supplier_id
      AND is_primary = true;
  UPDATE public.ingredients
    SET default_supplier_id = NEW.supplier_id
    WHERE id = NEW.ingredient_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_sync_default_supplier_ins
  AFTER INSERT ON public.ingredient_suppliers
  FOR EACH ROW WHEN (NEW.is_primary)
  EXECUTE FUNCTION public.sync_ingredient_default_supplier();

CREATE TRIGGER trg_sync_default_supplier_upd
  AFTER UPDATE OF is_primary ON public.ingredient_suppliers
  FOR EACH ROW WHEN (NEW.is_primary AND (OLD.is_primary IS DISTINCT FROM NEW.is_primary))
  EXECUTE FUNCTION public.sync_ingredient_default_supplier();

CREATE OR REPLACE FUNCTION public.clear_ingredient_default_on_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_primary THEN
    UPDATE public.ingredients
      SET default_supplier_id = NULL
      WHERE id = OLD.ingredient_id
        AND default_supplier_id = OLD.supplier_id;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_clear_default_on_delete
  AFTER DELETE ON public.ingredient_suppliers
  FOR EACH ROW EXECUTE FUNCTION public.clear_ingredient_default_on_delete();
