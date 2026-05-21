DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'productions_recipe_id_fkey') THEN
    ALTER TABLE public.productions ADD CONSTRAINT productions_recipe_id_fkey FOREIGN KEY (recipe_id) REFERENCES public.recipes(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'productions_restaurant_id_fkey') THEN
    ALTER TABLE public.productions ADD CONSTRAINT productions_restaurant_id_fkey FOREIGN KEY (restaurant_id) REFERENCES public.restaurants(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'production_items_ingredient_id_fkey') THEN
    ALTER TABLE public.production_items ADD CONSTRAINT production_items_ingredient_id_fkey FOREIGN KEY (ingredient_id) REFERENCES public.ingredients(id) ON DELETE RESTRICT;
  END IF;
END $$;
NOTIFY pgrst, 'reload schema';