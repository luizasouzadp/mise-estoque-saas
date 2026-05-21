import { supabase } from "@/integrations/supabase/client";

/**
 * Garante que uma ficha marcada como "armazenada em estoque" tenha um insumo
 * espelho na tabela ingredients (categoria "pré-preparo", vinculado pela
 * coluna source_recipe_id). Se is_stocked = false, remove o insumo espelho.
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
    if (existing) {
      await supabase
        .from("ingredients")
        .update({ name, unit, category: "pré-preparo" })
        .eq("id", existing.id);
    } else {
      await supabase.from("ingredients").insert({
        restaurant_id: restaurantId,
        source_recipe_id: recipeId,
        name,
        unit,
        category: "pré-preparo",
      });
    }
  } else if (existing) {
    await supabase.from("ingredients").delete().eq("id", existing.id);
  }
}
