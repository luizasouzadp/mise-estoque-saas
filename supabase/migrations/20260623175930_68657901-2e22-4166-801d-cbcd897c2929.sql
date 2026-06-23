-- Remove duplicate INSERT trigger that double-counted purchases into stock
DROP TRIGGER IF EXISTS trg_apply_purchase ON public.purchases;

-- Reconcile existing stock: every past purchase was applied twice, so subtract one extra count once
UPDATE public.ingredients i
SET current_stock = COALESCE(i.current_stock, 0) - COALESCE(p.total_qty, 0)
FROM (
  SELECT ingredient_id, SUM(quantity) AS total_qty
  FROM public.purchases
  GROUP BY ingredient_id
) p
WHERE p.ingredient_id = i.id;