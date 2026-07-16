
-- 1) recipes: add pdv_produto_id
ALTER TABLE public.recipes ADD COLUMN IF NOT EXISTS pdv_produto_id text;
CREATE UNIQUE INDEX IF NOT EXISTS recipes_pdv_produto_id_key ON public.recipes(pdv_produto_id) WHERE pdv_produto_id IS NOT NULL;

-- 2) vendas
CREATE TABLE public.vendas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  pdv_venda_id text NOT NULL,
  data_venda timestamptz NOT NULL,
  status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, pdv_venda_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendas TO authenticated;
GRANT ALL ON public.vendas TO service_role;
ALTER TABLE public.vendas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view vendas" ON public.vendas FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "managers insert vendas" ON public.vendas FOR INSERT WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers update vendas" ON public.vendas FOR UPDATE USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers delete vendas" ON public.vendas FOR DELETE USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE INDEX vendas_data_idx ON public.vendas(restaurant_id, data_venda DESC);

-- 3) vendas_itens
CREATE TABLE public.vendas_itens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  venda_id uuid NOT NULL REFERENCES public.vendas(id) ON DELETE CASCADE,
  pdv_produto_id text NOT NULL,
  quantidade numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendas_itens TO authenticated;
GRANT ALL ON public.vendas_itens TO service_role;
ALTER TABLE public.vendas_itens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view vendas_itens" ON public.vendas_itens FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "managers insert vendas_itens" ON public.vendas_itens FOR INSERT WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers update vendas_itens" ON public.vendas_itens FOR UPDATE USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers delete vendas_itens" ON public.vendas_itens FOR DELETE USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE INDEX vendas_itens_venda_idx ON public.vendas_itens(venda_id);
CREATE INDEX vendas_itens_produto_idx ON public.vendas_itens(restaurant_id, pdv_produto_id);

-- 4) estoque_estimado (NO trigger updating ingredients.current_stock)
CREATE TABLE public.estoque_estimado (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  origem_venda_id uuid REFERENCES public.vendas(id) ON DELETE SET NULL,
  quantidade numeric NOT NULL,
  data_movimento timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.estoque_estimado TO authenticated;
GRANT ALL ON public.estoque_estimado TO service_role;
ALTER TABLE public.estoque_estimado ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view estoque_estimado" ON public.estoque_estimado FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "managers insert estoque_estimado" ON public.estoque_estimado FOR INSERT WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers update estoque_estimado" ON public.estoque_estimado FOR UPDATE USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers delete estoque_estimado" ON public.estoque_estimado FOR DELETE USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE INDEX estoque_estimado_ing_idx ON public.estoque_estimado(restaurant_id, ingredient_id, data_movimento DESC);

-- 5) contagens
CREATE TABLE public.contagens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  data_contagem date NOT NULL,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  quantidade_contada numeric NOT NULL,
  usuario text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contagens TO authenticated;
GRANT ALL ON public.contagens TO service_role;
ALTER TABLE public.contagens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view contagens" ON public.contagens FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "managers insert contagens" ON public.contagens FOR INSERT WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers update contagens" ON public.contagens FOR UPDATE USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers delete contagens" ON public.contagens FOR DELETE USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE INDEX contagens_ing_idx ON public.contagens(restaurant_id, ingredient_id, data_contagem DESC);

-- 6) divergencias
CREATE TABLE public.divergencias (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  contagem_id uuid NOT NULL REFERENCES public.contagens(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  saldo_esperado numeric NOT NULL,
  quantidade_contada numeric NOT NULL,
  diferenca_qtd numeric NOT NULL,
  diferenca_percentual numeric NOT NULL,
  diferenca_valor numeric NOT NULL,
  status text NOT NULL DEFAULT 'a_conferir',
  semanas_consecutivas_negativas int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.divergencias TO authenticated;
GRANT ALL ON public.divergencias TO service_role;
ALTER TABLE public.divergencias ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members view divergencias" ON public.divergencias FOR SELECT USING (restaurant_id = current_restaurant_id());
CREATE POLICY "managers insert divergencias" ON public.divergencias FOR INSERT WITH CHECK (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers update divergencias" ON public.divergencias FOR UPDATE USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE POLICY "managers delete divergencias" ON public.divergencias FOR DELETE USING (restaurant_id = current_restaurant_id() AND is_manager_or_owner(auth.uid()));
CREATE INDEX divergencias_ing_idx ON public.divergencias(restaurant_id, ingredient_id, created_at DESC);
