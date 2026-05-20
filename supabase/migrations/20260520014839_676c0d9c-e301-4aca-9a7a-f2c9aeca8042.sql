-- Add name, frequency, weekday, last_completed_at to inventories
ALTER TABLE public.inventories
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS weekday smallint,
  ADD COLUMN IF NOT EXISTS last_completed_at timestamptz;

ALTER TABLE public.inventories
  DROP CONSTRAINT IF EXISTS inventories_frequency_check;
ALTER TABLE public.inventories
  ADD CONSTRAINT inventories_frequency_check CHECK (frequency IN ('daily','weekly','monthly'));

-- Junction inventory <-> groups (one inventory may cover multiple groups)
CREATE TABLE IF NOT EXISTS public.inventory_groups (
  inventory_id uuid NOT NULL REFERENCES public.inventories(id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.ingredient_groups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (inventory_id, group_id)
);

ALTER TABLE public.inventory_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members view inventory_groups" ON public.inventory_groups;
CREATE POLICY "members view inventory_groups" ON public.inventory_groups
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.inventories inv
    WHERE inv.id = inventory_groups.inventory_id
      AND inv.restaurant_id = current_restaurant_id()));

DROP POLICY IF EXISTS "managers manage inventory_groups" ON public.inventory_groups;
CREATE POLICY "managers manage inventory_groups" ON public.inventory_groups
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.inventories inv
    WHERE inv.id = inventory_groups.inventory_id
      AND inv.restaurant_id = current_restaurant_id()
      AND is_manager_or_owner(auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.inventories inv
    WHERE inv.id = inventory_groups.inventory_id
      AND inv.restaurant_id = current_restaurant_id()
      AND is_manager_or_owner(auth.uid())));

-- Items: allow direct association to inventory (no session required) + carry group_id for display
ALTER TABLE public.inventory_items
  ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS group_id uuid;