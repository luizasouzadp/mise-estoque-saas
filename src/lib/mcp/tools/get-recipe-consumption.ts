import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "get_recipe_consumption",
  title: "Consumo por receita",
  description:
    "Para cada receita, retorna quanto foi produzido no período e o consumo agregado de ingredientes via production_items.",
  inputSchema: {
    since: z.string().datetime().optional().describe("Início do período (ISO)."),
    until: z.string().datetime().optional().describe("Fim do período (ISO)."),
    recipe_id: z.string().uuid().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ since, until, recipe_id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("productions")
      .select(
        "id, recipe_id, quantity_produced, produced_at, recipes!inner(name), production_items(ingredient_id, ingredient_name, quantity, unit)",
      )
      .order("produced_at", { ascending: false });
    if (since) q = q.gte("produced_at", since);
    if (until) q = q.lte("produced_at", until);
    if (recipe_id) q = q.eq("recipe_id", recipe_id);
    const { data, error } = await q;
    if (error) return err(error.message);

    type Row = {
      recipe_id: string;
      quantity_produced: number;
      recipes: { name: string };
      production_items: { ingredient_id: string; ingredient_name: string; quantity: number; unit: string }[];
    };
    const byRecipe = new Map<
      string,
      { recipe_id: string; recipe_name: string; total_produced: number; ingredients: Map<string, { name: string; qty: number; unit: string }> }
    >();
    for (const p of (data ?? []) as unknown as Row[]) {
      const entry =
        byRecipe.get(p.recipe_id) ??
        {
          recipe_id: p.recipe_id,
          recipe_name: p.recipes?.name ?? "?",
          total_produced: 0,
          ingredients: new Map<string, { name: string; qty: number; unit: string }>(),
        };
      entry.total_produced += Number(p.quantity_produced ?? 0);
      for (const it of p.production_items ?? []) {
        const cur = entry.ingredients.get(it.ingredient_id) ?? {
          name: it.ingredient_name,
          qty: 0,
          unit: it.unit,
        };
        cur.qty += Number(it.quantity ?? 0);
        entry.ingredients.set(it.ingredient_id, cur);
      }
      byRecipe.set(p.recipe_id, entry);
    }
    const result = Array.from(byRecipe.values()).map((r) => ({
      recipe_id: r.recipe_id,
      recipe_name: r.recipe_name,
      total_produced: Number(r.total_produced.toFixed(3)),
      ingredients_consumed: Array.from(r.ingredients.entries()).map(([id, v]) => ({
        ingredient_id: id,
        name: v.name,
        quantity: Number(v.qty.toFixed(3)),
        unit: v.unit,
      })),
    }));
    return ok({ recipes: result });
  },
});
