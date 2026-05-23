ALTER TABLE public.menu_products ADD COLUMN IF NOT EXISTS product_code text;

ALTER TABLE public.cmv_reports
  ADD COLUMN IF NOT EXISTS theoretical_cost numeric,
  ADD COLUMN IF NOT EXISTS theoretical_percent numeric,
  ADD COLUMN IF NOT EXISTS sales_data jsonb;