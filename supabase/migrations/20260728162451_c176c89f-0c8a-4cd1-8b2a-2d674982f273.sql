ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS ingredients_is_active_idx ON public.ingredients(is_active);