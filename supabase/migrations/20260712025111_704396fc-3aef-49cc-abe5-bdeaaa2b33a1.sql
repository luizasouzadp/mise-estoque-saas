
ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS delivery_days smallint[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS order_days smallint[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS lead_time_days integer,
  ADD COLUMN IF NOT EXISTS min_order_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS notes text;

ALTER TABLE public.suppliers
  DROP CONSTRAINT IF EXISTS suppliers_delivery_days_range,
  DROP CONSTRAINT IF EXISTS suppliers_order_days_range,
  DROP CONSTRAINT IF EXISTS suppliers_lead_time_nonneg,
  DROP CONSTRAINT IF EXISTS suppliers_min_order_nonneg;

ALTER TABLE public.suppliers
  ADD CONSTRAINT suppliers_delivery_days_range
    CHECK (delivery_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  ADD CONSTRAINT suppliers_order_days_range
    CHECK (order_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]),
  ADD CONSTRAINT suppliers_lead_time_nonneg
    CHECK (lead_time_days IS NULL OR lead_time_days >= 0),
  ADD CONSTRAINT suppliers_min_order_nonneg
    CHECK (min_order_value IS NULL OR min_order_value >= 0);

ALTER TABLE public.ingredients
  ADD COLUMN IF NOT EXISTS default_supplier_id uuid REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ingredients_default_supplier
  ON public.ingredients(default_supplier_id);
