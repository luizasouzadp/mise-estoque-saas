-- Every purchase teaches the ingredient who sells it:
--   * ingredient without a primary supplier -> the purchase's supplier becomes primary
--   * ingredient that already has a primary -> any other supplier it was bought
--     from is linked as secondary (is_primary = false)
-- purchases.supplier is free text, so it is matched to suppliers by name
-- (case/space-insensitive) within the same restaurant.

CREATE OR REPLACE FUNCTION public.link_supplier_from_purchase()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _supplier_id uuid;
  _has_primary boolean;
BEGIN
  IF NEW.supplier IS NULL OR btrim(NEW.supplier) = '' THEN
    RETURN NEW;
  END IF;

  SELECT s.id INTO _supplier_id
  FROM public.suppliers s
  WHERE s.restaurant_id = NEW.restaurant_id
    AND lower(btrim(s.name)) = lower(btrim(NEW.supplier))
  ORDER BY s.created_at
  LIMIT 1;

  IF _supplier_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.ingredient_suppliers
    WHERE ingredient_id = NEW.ingredient_id AND is_primary
  ) INTO _has_primary;

  IF NOT _has_primary THEN
    INSERT INTO public.ingredient_suppliers (ingredient_id, supplier_id, restaurant_id, is_primary)
    VALUES (NEW.ingredient_id, _supplier_id, NEW.restaurant_id, true)
    ON CONFLICT (ingredient_id, supplier_id) DO UPDATE SET is_primary = true;
  ELSE
    INSERT INTO public.ingredient_suppliers (ingredient_id, supplier_id, restaurant_id, is_primary)
    VALUES (NEW.ingredient_id, _supplier_id, NEW.restaurant_id, false)
    ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_supplier_from_purchase ON public.purchases;
CREATE TRIGGER trg_link_supplier_from_purchase
  AFTER INSERT ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.link_supplier_from_purchase();

-- Backfill from purchase history.
-- 1) Ingredients without a primary: the supplier of the most recent purchase becomes primary.
WITH last_sup AS (
  SELECT DISTINCT ON (p.ingredient_id)
    p.ingredient_id, p.restaurant_id, s.id AS supplier_id
  FROM public.purchases p
  JOIN public.suppliers s
    ON s.restaurant_id = p.restaurant_id
   AND lower(btrim(s.name)) = lower(btrim(p.supplier))
  WHERE p.supplier IS NOT NULL AND btrim(p.supplier) <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.ingredient_suppliers x
      WHERE x.ingredient_id = p.ingredient_id AND x.is_primary
    )
  ORDER BY p.ingredient_id, p.purchased_at DESC, p.created_at DESC
)
INSERT INTO public.ingredient_suppliers (ingredient_id, supplier_id, restaurant_id, is_primary)
SELECT ingredient_id, supplier_id, restaurant_id, true FROM last_sup
ON CONFLICT (ingredient_id, supplier_id) DO UPDATE SET is_primary = true;

-- 2) Every other supplier an ingredient was bought from becomes secondary.
INSERT INTO public.ingredient_suppliers (ingredient_id, supplier_id, restaurant_id, is_primary)
SELECT DISTINCT p.ingredient_id, s.id, p.restaurant_id, false
FROM public.purchases p
JOIN public.suppliers s
  ON s.restaurant_id = p.restaurant_id
 AND lower(btrim(s.name)) = lower(btrim(p.supplier))
WHERE p.supplier IS NOT NULL AND btrim(p.supplier) <> ''
ON CONFLICT (ingredient_id, supplier_id) DO NOTHING;
