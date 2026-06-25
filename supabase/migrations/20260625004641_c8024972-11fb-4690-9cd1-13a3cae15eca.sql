
-- Allow chefs to manage productions in their restaurant
CREATE POLICY "chefs insert productions" ON public.productions
  FOR INSERT TO authenticated
  WITH CHECK (restaurant_id = current_restaurant_id() AND has_role(auth.uid(), 'chef'));

CREATE POLICY "chefs update productions" ON public.productions
  FOR UPDATE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND has_role(auth.uid(), 'chef'))
  WITH CHECK (restaurant_id = current_restaurant_id() AND has_role(auth.uid(), 'chef'));

CREATE POLICY "chefs delete productions" ON public.productions
  FOR DELETE TO authenticated
  USING (restaurant_id = current_restaurant_id() AND has_role(auth.uid(), 'chef'));

CREATE POLICY "chefs manage production_items" ON public.production_items
  FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM productions p WHERE p.id = production_items.production_id AND p.restaurant_id = current_restaurant_id() AND has_role(auth.uid(), 'chef')))
  WITH CHECK (EXISTS (SELECT 1 FROM productions p WHERE p.id = production_items.production_id AND p.restaurant_id = current_restaurant_id() AND has_role(auth.uid(), 'chef')));
