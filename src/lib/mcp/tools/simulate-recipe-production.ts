import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

type ExpandedItem = { ingredient_id: string; name: string; unit: string; qty: number };

async function expandRecipe(
  supabase: ReturnType<typeof supabaseForUser>,
  recipeId: string,
  multiplier: number,
  depth = 0,
  acc = new Map<string, ExpandedItem>(),
): Promise<Map<string, ExpandedItem>> {
  if (depth > 10) return acc;
  const { data: recipe } = await supabase
    .from("recipes")
    .select("yield_qty")
    .eq("id", recipeId)
    .maybeSingle();
  const y = Number(recipe?.yield_qty ?? 1) || 1;
  const scale = multiplier / y;
  const { data: items } = await supabase
    .from("recipe_items")
    .select("item_type, ingredient_id, sub_recipe_id, quantity, unit, ingredients(id, name, unit)")
    .eq("recipe_id", recipeId);
  for (const it of items ?? []) {
    const qty = Number(it.quantity ?? 0) * scale;
    if (it.item_type === "ingredient" && it.ingredient_id) {
      const ing = (it as unknown as { ingredients: { id: string; name: string; unit: string } | null }).ingredients;
      const key = it.ingredient_id;
      const cur = acc.get(key);
      if (cur) cur.qty += qty;
      else
        acc.set(key, {
          ingredient_id: it.ingredient_id,
          name: ing?.name ?? "?",
          unit: ing?.unit ?? it.unit,
          qty,
        });
    } else if (it.item_type === "recipe" && it.sub_recipe_id) {
      await expandRecipe(supabase, it.sub_recipe_id, qty, depth + 1, acc);
    }
  }
  return acc;
}

export default defineTool({
  name: "simulate_recipe_production",
  title: "Simular produção de receita",
  description:
    "Simula a produção de uma quantidade de uma receita e retorna os ingredientes que seriam consumidos, sinalizando quais não têm estoque suficiente. NÃO altera o estoque.",
  inputSchema: {
    recipe_id: z.string().uuid(),
    quantity: z.number().positive(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ recipe_id, quantity }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data: rec, error } = await supabase
      .from("recipes")
      .select("id, name, yield_qty, yield_unit")
      .eq("id", recipe_id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!rec) return err("Receita não encontrada.");
    const expanded = await expandRecipe(supabase, recipe_id, quantity);
    const ingIds = Array.from(expanded.keys());
    const { data: stocks } = await supabase
      .from("ingredients")
      .select("id, current_stock")
      .in("id", ingIds);
    const stockMap = new Map((stocks ?? []).map((s) => [s.id, Number(s.current_stock ?? 0)]));
    const rows = Array.from(expanded.values()).map((e) => {
      const stock = stockMap.get(e.ingredient_id) ?? 0;
      return {
        ingredient_id: e.ingredient_id,
        name: e.name,
        unit: e.unit,
        needed_qty: Number(e.qty.toFixed(3)),
        current_stock: stock,
        sufficient: stock >= e.qty,
        shortfall: stock >= e.qty ? 0 : Number((e.qty - stock).toFixed(3)),
      };
    });
    const feasible = rows.every((r) => r.sufficient);
    return ok({
      recipe: { id: rec.id, name: rec.name },
      quantity_to_produce: quantity,
      feasible,
      ingredients_needed: rows,
    });
  },
});
