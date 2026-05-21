
ALTER TABLE public.recipes
  ADD COLUMN IF NOT EXISTS is_on_menu boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS menu_category text,
  ADD COLUMN IF NOT EXISTS current_price numeric;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS ideal_cmv numeric NOT NULL DEFAULT 30;
