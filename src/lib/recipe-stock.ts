import { supabase } from "@/integrations/supabase/client";

/**
 * Garante que uma ficha marcada como "armazenada em estoque" tenha um insumo
 * espelho na tabela ingredients (categoria "sub-receita", vinculado pela
 * coluna source_recipe_id). Se is_stocked = false, remove o insumo espelho.
 * Também atualiza o custo médio do insumo com o custo unitário da ficha.
 */
export async function syncRecipeStockIngredient(args: {
  recipeId: string;
  restaurantId: string;
  isStocked: boolean;
  name: string;
  unit: string;
}) {
  const { recipeId, restaurantId, isStocked, name, unit } = args;

  // Busca insumo existente vinculado
  let { data: existing } = await supabase
    .from("ingredients")
    .select("id, category")
    .eq("source_recipe_id", recipeId)
    .maybeSingle();

  // Fallback: revincula insumo espelho órfão (categoria "sub-receita") de mesmo nome.
  // Só para ficha em estoque e nunca um insumo comprado: antes, salvar o prato
  // "Iscas de alcatra" ligava (e tentava apagar) o insumo comprado de mesmo nome.
  if (!existing && isStocked) {
    const { data: orphan } = await supabase
      .from("ingredients")
      .select("id, category")
      .eq("restaurant_id", restaurantId)
      .ilike("name", name)
      .eq("category", "sub-receita")
      .is("source_recipe_id", null)
      .maybeSingle();
    if (orphan) {
      await supabase
        .from("ingredients")
        .update({ source_recipe_id: recipeId })
        .eq("id", orphan.id);
      existing = orphan;
    }
  }

  if (isStocked) {
    // Calcula custo unitário atual da ficha
    const { data: unitCost } = await supabase.rpc("recipe_unit_cost", { _recipe_id: recipeId });
    const cost = Number(unitCost ?? 0);

    if (existing) {
      await supabase
        .from("ingredients")
        .update({ name, unit, category: "sub-receita", avg_cost: cost, last_cost: cost })
        .eq("id", existing.id);
    } else {
      await supabase.from("ingredients").insert({
        restaurant_id: restaurantId,
        source_recipe_id: recipeId,
        name,
        unit,
        category: "sub-receita",
        avg_cost: cost,
        last_cost: cost,
      });
    }
  } else if (existing) {
    if (existing.category === "sub-receita") {
      // Espelho criado pelo sistema: remove (ou só desvincula, se estiver em uso).
      const { error } = await supabase.from("ingredients").delete().eq("id", existing.id);
      if (error) {
        await supabase.from("ingredients").update({ source_recipe_id: null }).eq("id", existing.id);
      }
    } else {
      // Insumo comprado ligado por engano: só desvincula, não apaga.
      await supabase.from("ingredients").update({ source_recipe_id: null }).eq("id", existing.id);
    }
  }
}
