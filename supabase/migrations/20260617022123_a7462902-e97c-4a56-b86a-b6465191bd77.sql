
CREATE TABLE public.sales_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  reference_month date NOT NULL,
  file_name text,
  total_revenue numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  total_margin numeric NOT NULL DEFAULT 0,
  total_quantity numeric NOT NULL DEFAULT 0,
  ai_insights text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_reports TO authenticated;
GRANT ALL ON public.sales_reports TO service_role;
ALTER TABLE public.sales_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view sales_reports" ON public.sales_reports FOR SELECT TO authenticated
  USING (restaurant_id = current_restaurant_id());
CREATE POLICY "managers insert sales_reports" ON public.sales_reports FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers update sales_reports" ON public.sales_reports FOR UPDATE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers delete sales_reports" ON public.sales_reports FOR DELETE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE TRIGGER set_updated_at_sales_reports BEFORE UPDATE ON public.sales_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.sales_report_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.sales_reports(id) ON DELETE CASCADE,
  product_code text NOT NULL,
  item_name text NOT NULL,
  category text,
  source text NOT NULL CHECK (source IN ('recipe','menu_product')),
  recipe_id uuid REFERENCES public.recipes(id) ON DELETE SET NULL,
  menu_product_id uuid REFERENCES public.menu_products(id) ON DELETE SET NULL,
  quantity numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  unit_cost numeric NOT NULL DEFAULT 0,
  revenue numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  margin numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_report_items_report_idx ON public.sales_report_items(report_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_report_items TO authenticated;
GRANT ALL ON public.sales_report_items TO service_role;
ALTER TABLE public.sales_report_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view sales_report_items" ON public.sales_report_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_reports r WHERE r.id = report_id AND r.restaurant_id = current_restaurant_id()));
CREATE POLICY "managers manage sales_report_items" ON public.sales_report_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_reports r WHERE r.id = report_id AND r.restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sales_reports r WHERE r.id = report_id AND r.restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid())));

CREATE TABLE public.sales_report_unmapped (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.sales_reports(id) ON DELETE CASCADE,
  product_code text NOT NULL,
  quantity numeric NOT NULL DEFAULT 0,
  revenue numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sales_report_unmapped_report_idx ON public.sales_report_unmapped(report_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_report_unmapped TO authenticated;
GRANT ALL ON public.sales_report_unmapped TO service_role;
ALTER TABLE public.sales_report_unmapped ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view sales_report_unmapped" ON public.sales_report_unmapped FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_reports r WHERE r.id = report_id AND r.restaurant_id = current_restaurant_id()));
CREATE POLICY "managers manage sales_report_unmapped" ON public.sales_report_unmapped FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.sales_reports r WHERE r.id = report_id AND r.restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.sales_reports r WHERE r.id = report_id AND r.restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid())));
