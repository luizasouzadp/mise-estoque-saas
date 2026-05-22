
CREATE TABLE public.cmv_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  revenue numeric NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  cmv_percent numeric NOT NULL DEFAULT 0,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cmv_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view cmv_reports" ON public.cmv_reports
  FOR SELECT TO authenticated
  USING (restaurant_id = current_restaurant_id());

CREATE POLICY "managers insert cmv_reports" ON public.cmv_reports
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE POLICY "managers update cmv_reports" ON public.cmv_reports
  FOR UPDATE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE POLICY "managers delete cmv_reports" ON public.cmv_reports
  FOR DELETE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));

CREATE TRIGGER set_cmv_reports_updated_at
  BEFORE UPDATE ON public.cmv_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
