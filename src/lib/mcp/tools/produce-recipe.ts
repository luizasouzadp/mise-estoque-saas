import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, getRestaurantId, notAuthed, err, ok } from "../lib/supabase-for-user";

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
  name: "produce_recipe",
  title: "Produzir receita",
  description:
    "Registra a produção de uma receita e insere production_items para cada ingrediente consumido. O trigger apply_stock_movement desconta o estoque. Requer aprovação por alterar estoque.",
  inputSchema: {
    recipe_id: z.string().uuid(),
    quantity: z.number().positive(),
    notes: z.string().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ recipe_id, quantity, notes }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();
    if (!userId) return err("Usuário não identificado.");
    const restaurantId = await getRestaurantId(supabase, userId);
    if (!restaurantId) return err("Restaurante não encontrado.");
    const expanded = await expandRecipe(supabase, recipe_id, quantity);

    const { data: prod, error: pe } = await supabase
      .from("productions")
      .insert({ restaurant_id: restaurantId, recipe_id, quantity_produced: quantity, notes: notes ?? null })
      .select()
      .single();
    if (pe) return err(pe.message);

    const rows = Array.from(expanded.values()).map((e) => ({
      production_id: prod.id,
      ingredient_id: e.ingredient_id,
      ingredient_name: e.name,
      quantity: Number(e.qty.toFixed(3)),
      unit: e.unit,
    }));
    if (rows.length) {
      const { error: ie } = await supabase.from("production_items").insert(rows);
      if (ie) return err(ie.message);
    }

    // Also record stock movements (out) so the trigger updates ingredients.current_stock
    const movements = rows.map((r) => ({
      restaurant_id: restaurantId,
      ingredient_id: r.ingredient_id,
      type: "out" as const,
      quantity: r.quantity,
      reason: `Produção · receita ${recipe_id}`,
    }));
    if (movements.length) {
      const { error: me } = await supabase.from("stock_movements").insert(movements);
      if (me) return err(me.message);
    }

    return ok(
      { production_id: prod.id, quantity, items_consumed: rows },
      `Produção registrada: ${rows.length} ingredientes consumidos.`,
    );
  },
});
