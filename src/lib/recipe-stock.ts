import { supabase } from "@/integrations/supabase/client";

/**
 * Garante que uma ficha marcada como "armazenada em estoque" tenha um insumo
 * espelho na tabela ingredients (categoria "pré-preparo", vinculado pela
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
  const { data: existing } = await supabase
    .from("ingredients")
    .select("id")
    .eq("source_recipe_id", recipeId)
    .maybeSingle();

  if (isStocked) {
    // Calcula custo unitário atual da ficha
    const { data: unitCost } = await supabase.rpc("recipe_unit_cost", { _recipe_id: recipeId });
    const cost = Number(unitCost ?? 0);

    if (existing) {
      await supabase
        .from("ingredients")
        .update({ name, unit, category: "pré-preparo", avg_cost: cost, last_cost: cost })
        .eq("id", existing.id);
    } else {
      await supabase.from("ingredients").insert({
        restaurant_id: restaurantId,
        source_recipe_id: recipeId,
        name,
        unit,
        category: "pré-preparo",
        avg_cost: cost,
        last_cost: cost,
      });
    }
  } else if (existing) {
    await supabase.from("ingredients").delete().eq("id", existing.id);
  }
}
