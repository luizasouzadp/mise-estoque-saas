import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "calculate_recipe_cost",
  title: "Custo atualizado da ficha técnica",
  description:
    "Retorna o custo total e unitário de uma ficha técnica, usando as funções recipe_total_cost/recipe_unit_cost do banco (que expandem sub-receitas e usam custo médio dos últimos 30 dias).",
  inputSchema: { recipe_id: z.string().uuid() },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ recipe_id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data: r, error } = await supabase
      .from("recipes")
      .select("id, name, yield_qty, yield_unit, current_price")
      .eq("id", recipe_id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!r) return err("Receita não encontrada.");
    const [{ data: total }, { data: unit }] = await Promise.all([
      supabase.rpc("recipe_total_cost", { _recipe_id: recipe_id, _depth: 0 }),
      supabase.rpc("recipe_unit_cost", { _recipe_id: recipe_id }),
    ]);
    return ok({
      recipe: { id: r.id, name: r.name, yield_qty: Number(r.yield_qty), yield_unit: r.yield_unit },
      total_cost: Number(total ?? 0),
      unit_cost: Number(unit ?? 0),
      current_price: r.current_price != null ? Number(r.current_price) : null,
    });
  },
});
