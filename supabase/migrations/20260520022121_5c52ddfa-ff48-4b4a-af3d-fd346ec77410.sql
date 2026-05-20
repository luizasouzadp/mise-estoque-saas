-- Stock movements: unified entries/exits with auto stock adjustment
CREATE TABLE public.stock_movements (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL,
  ingredient_id UUID NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('in','out')),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC,
  reason TEXT,
  notes TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_stock_movements_restaurant ON public.stock_movements(restaurant_id, occurred_at DESC);
CREATE INDEX idx_stock_movements_ingredient ON public.stock_movements(ingredient_id, occurred_at DESC);

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view stock_movements" ON public.stock_movements
  FOR SELECT TO authenticated
  USING (restaurant_id = current_restaurant_id());

CREATE POLICY "managers insert stock_movements" ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE POLICY "managers update stock_movements" ON public.stock_movements
  FOR UPDATE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE POLICY "managers delete stock_movements" ON public.stock_movements
  FOR DELETE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE TRIGGER set_stock_movements_updated_at
  BEFORE UPDATE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Apply signed delta to ingredient stock on INSERT/UPDATE/DELETE
CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_delta NUMERIC := 0;
  new_delta NUMERIC := 0;
BEGIN
  IF TG_OP IN ('UPDATE','DELETE') THEN
    old_delta := CASE WHEN OLD.type = 'in' THEN OLD.quantity ELSE -OLD.quantity END;
    UPDATE public.ingredients
      SET current_stock = COALESCE(current_stock,0) - old_delta
      WHERE id = OLD.ingredient_id;
  END IF;
  IF TG_OP IN ('INSERT','UPDATE') THEN
    new_delta := CASE WHEN NEW.type = 'in' THEN NEW.quantity ELSE -NEW.quantity END;
    UPDATE public.ingredients
      SET current_stock = COALESCE(current_stock,0) + new_delta,
          last_cost = CASE WHEN NEW.type = 'in' AND NEW.unit_cost IS NOT NULL THEN NEW.unit_cost ELSE last_cost END
      WHERE id = NEW.ingredient_id;
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$$;

CREATE TRIGGER trg_apply_stock_movement
  AFTER INSERT OR UPDATE OR DELETE ON public.stock_movements
  FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();