
-- Daily sales reports (one per day per restaurant)
CREATE TABLE public.daily_sales_reports (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  sales_date DATE NOT NULL,
  file_name TEXT,
  total_revenue NUMERIC NOT NULL DEFAULT 0,
  total_quantity NUMERIC NOT NULL DEFAULT 0,
  mapped_count INTEGER NOT NULL DEFAULT 0,
  unmapped_count INTEGER NOT NULL DEFAULT 0,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, sales_date)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_sales_reports TO authenticated;
GRANT ALL ON public.daily_sales_reports TO service_role;
ALTER TABLE public.daily_sales_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view daily_sales_reports" ON public.daily_sales_reports
  FOR SELECT TO authenticated
  USING (restaurant_id = public.current_restaurant_id());
CREATE POLICY "managers insert daily_sales_reports" ON public.daily_sales_reports
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = public.current_restaurant_id() AND public.is_manager_or_owner(auth.uid()));
CREATE POLICY "managers update daily_sales_reports" ON public.daily_sales_reports
  FOR UPDATE TO authenticated
  USING (restaurant_id = public.current_restaurant_id() AND public.is_manager_or_owner(auth.uid()));
CREATE POLICY "managers delete daily_sales_reports" ON public.daily_sales_reports
  FOR DELETE TO authenticated
  USING (restaurant_id = public.current_restaurant_id() AND public.is_manager_or_owner(auth.uid()));

CREATE TRIGGER trg_daily_sales_reports_updated_at
  BEFORE UPDATE ON public.daily_sales_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX idx_dsr_restaurant_date ON public.daily_sales_reports(restaurant_id, sales_date DESC);

-- Per-ingredient theoretical consumption for each daily report
CREATE TABLE public.daily_sales_consumption (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  daily_report_id UUID NOT NULL REFERENCES public.daily_sales_reports(id) ON DELETE CASCADE,
  restaurant_id UUID NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  ingredient_id UUID NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  sales_date DATE NOT NULL,
  quantity_theoretical NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.daily_sales_consumption TO authenticated;
GRANT ALL ON public.daily_sales_consumption TO service_role;
ALTER TABLE public.daily_sales_consumption ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view daily_sales_consumption" ON public.daily_sales_consumption
  FOR SELECT TO authenticated
  USING (restaurant_id = public.current_restaurant_id());
CREATE POLICY "managers write daily_sales_consumption" ON public.daily_sales_consumption
  FOR ALL TO authenticated
  USING (restaurant_id = public.current_restaurant_id() AND public.is_manager_or_owner(auth.uid()))
  WITH CHECK (restaurant_id = public.current_restaurant_id() AND public.is_manager_or_owner(auth.uid()));

CREATE INDEX idx_dsc_report ON public.daily_sales_consumption(daily_report_id);
CREATE INDEX idx_dsc_ing_date ON public.daily_sales_consumption(ingredient_id, sales_date);

-- Projected stock for a single ingredient
CREATE OR REPLACE FUNCTION public.projected_stock_for_ingredient(_ingredient_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current NUMERIC := 0;
  v_anchor TIMESTAMPTZ;
  v_consumed NUMERIC := 0;
BEGIN
  SELECT current_stock, created_at INTO v_current, v_anchor
  FROM public.ingredients WHERE id = _ingredient_id;
  IF NOT FOUND THEN RETURN 0; END IF;

  SELECT COALESCE(MAX(occurred_at), v_anchor) INTO v_anchor
  FROM public.stock_movements
  WHERE ingredient_id = _ingredient_id
    AND reason ILIKE 'Inventário%';

  SELECT COALESCE(SUM(quantity_theoretical), 0) INTO v_consumed
  FROM public.daily_sales_consumption
  WHERE ingredient_id = _ingredient_id
    AND sales_date > v_anchor::date;

  RETURN COALESCE(v_current, 0) - COALESCE(v_consumed, 0);
END;
$$;

-- Batch view for the alert screen (returns rows for the caller's restaurant, RLS via ingredients)
CREATE OR REPLACE FUNCTION public.projected_stock_status()
RETURNS TABLE (
  ingredient_id UUID,
  ingredient_name TEXT,
  unit TEXT,
  current_stock NUMERIC,
  min_stock NUMERIC,
  projected_stock NUMERIC,
  anchor_at TIMESTAMPTZ,
  days_since_anchor INTEGER,
  consumed_since_anchor NUMERIC,
  status TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH anchors AS (
    SELECT
      i.id AS ing_id,
      i.name,
      i.unit,
      i.current_stock,
      i.min_stock,
      COALESCE(
        (SELECT MAX(sm.occurred_at) FROM public.stock_movements sm
          WHERE sm.ingredient_id = i.id AND sm.reason ILIKE 'Inventário%'),
        i.created_at
      ) AS anchor_at
    FROM public.ingredients i
    WHERE i.restaurant_id = public.current_restaurant_id()
  ),
  consumed AS (
    SELECT a.ing_id,
           COALESCE(SUM(c.quantity_theoretical), 0) AS consumed_qty
    FROM anchors a
    LEFT JOIN public.daily_sales_consumption c
      ON c.ingredient_id = a.ing_id
     AND c.sales_date > a.anchor_at::date
    GROUP BY a.ing_id
  )
  SELECT
    a.ing_id,
    a.name,
    a.unit,
    a.current_stock,
    a.min_stock,
    a.current_stock - c.consumed_qty AS projected_stock,
    a.anchor_at,
    GREATEST(0, (CURRENT_DATE - a.anchor_at::date))::int AS days_since_anchor,
    c.consumed_qty,
    CASE
      WHEN a.current_stock - c.consumed_qty <= 0 THEN 'zerado'
      WHEN a.min_stock > 0 AND (a.current_stock - c.consumed_qty) < a.min_stock THEN 'abaixo_minimo'
      WHEN a.min_stock > 0 AND (a.current_stock - c.consumed_qty) < a.min_stock * 1.15 THEN 'proximo_minimo'
      ELSE 'ok'
    END AS status
  FROM anchors a
  JOIN consumed c ON c.ing_id = a.ing_id;
$$;

GRANT EXECUTE ON FUNCTION public.projected_stock_for_ingredient(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.projected_stock_status() TO authenticated;
