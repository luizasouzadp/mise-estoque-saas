import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "calculate_food_cost",
  title: "Food Cost por produto/receita",
  description:
    "Calcula o Food Cost (custo/preço de venda × 100) para uma receita ou produto de cardápio. Se nenhum id for informado, retorna a lista de todas as receitas no cardápio.",
  inputSchema: {
    recipe_id: z.string().uuid().optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ recipe_id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    if (recipe_id) {
      const [{ data: r, error }, { data: unit }] = await Promise.all([
        supabase
          .from("recipes")
          .select("id, name, current_price")
          .eq("id", recipe_id)
          .maybeSingle(),
        supabase.rpc("recipe_unit_cost", { _recipe_id: recipe_id }),
      ]);
      if (error) return err(error.message);
      if (!r) return err("Receita não encontrada.");
      const cost = Number(unit ?? 0);
      const price = r.current_price != null ? Number(r.current_price) : 0;
      const fc = price > 0 ? (cost / price) * 100 : null;
      return ok({
        recipe_id: r.id,
        name: r.name,
        unit_cost: cost,
        price,
        food_cost_percent: fc != null ? Number(fc.toFixed(2)) : null,
      });
    }
    const { data: recipes, error } = await supabase
      .from("recipes")
      .select("id, name, current_price")
      .eq("is_on_menu", true);
    if (error) return err(error.message);
    const out: {
      recipe_id: string;
      name: string;
      unit_cost: number;
      price: number;
      food_cost_percent: number | null;
    }[] = [];
    for (const r of recipes ?? []) {
      const { data: unit } = await supabase.rpc("recipe_unit_cost", { _recipe_id: r.id });
      const cost = Number(unit ?? 0);
      const price = r.current_price != null ? Number(r.current_price) : 0;
      const fc = price > 0 ? (cost / price) * 100 : null;
      out.push({
        recipe_id: r.id,
        name: r.name,
        unit_cost: cost,
        price,
        food_cost_percent: fc != null ? Number(fc.toFixed(2)) : null,
      });
    }
    return ok({ items: out.sort((a, b) => (b.food_cost_percent ?? 0) - (a.food_cost_percent ?? 0)) });
  },
});
