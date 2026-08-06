ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'receiver';

CREATE TABLE public.pending_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  supplier_name text,
  notes text,
  image_paths text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pending_invoices TO authenticated;
GRANT ALL ON public.pending_invoices TO service_role;

ALTER TABLE public.pending_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members view pending_invoices" ON public.pending_invoices
  FOR SELECT TO authenticated
  USING (restaurant_id = public.current_restaurant_id());

CREATE POLICY "members insert pending_invoices" ON public.pending_invoices
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = public.current_restaurant_id());

CREATE POLICY "members update pending_invoices" ON public.pending_invoices
  FOR UPDATE TO authenticated
  USING (restaurant_id = public.current_restaurant_id())
  WITH CHECK (restaurant_id = public.current_restaurant_id());

CREATE POLICY "managers delete pending_invoices" ON public.pending_invoices
  FOR DELETE TO authenticated
  USING (restaurant_id = public.current_restaurant_id() AND public.is_manager_or_owner(auth.uid()));

CREATE TRIGGER trg_pending_invoices_updated_at
  BEFORE UPDATE ON public.pending_invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();