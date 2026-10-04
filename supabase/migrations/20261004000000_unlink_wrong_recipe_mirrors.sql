-- Desfaz vínculos errados entre insumos comprados e fichas técnicas.
-- Ao salvar uma ficha (ex.: prato "Iscas de alcatra"), o app ligava o insumo comprado
-- de mesmo nome à ficha, como se fosse produzido por ela. Isso tirava o insumo da lista
-- de compras. Solta o vínculo (não apaga nada) quando a ficha não existe mais, não fica
-- em estoque ou usa o próprio insumo como ingrediente.
UPDATE public.ingredients i
SET source_recipe_id = NULL
WHERE i.source_recipe_id IS NOT NULL
  AND (
    NOT EXISTS (SELECT 1 FROM public.recipes r WHERE r.id = i.source_recipe_id AND r.is_stocked)
    OR EXISTS (
      SELECT 1 FROM public.recipe_items ri
      WHERE ri.recipe_id = i.source_recipe_id AND ri.ingredient_id = i.id
    )
  );
