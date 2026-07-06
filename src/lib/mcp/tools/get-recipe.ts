import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_recipe",
  title: "Detalhar ficha técnica",
  description:
    "Retorna os detalhes de uma ficha técnica pelo id: cabeçalho, itens (insumos e sub-fichas com quantidade, unidade e custo de linha) e custo total/unitário.",
  inputSchema: {
    recipe_id: z.string().uuid().describe("ID da ficha técnica (recipes.id)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ recipe_id }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: recipe, error } = await supabase
      .from("recipes")
      .select("id, name, description, yield_qty, yield_unit, is_on_menu, menu_category, current_price")
      .eq("id", recipe_id)
      .maybeSingle();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    if (!recipe) return { content: [{ type: "text", text: "Ficha não encontrada" }], isError: true };

    const { data: items } = await supabase
      .from("recipe_items")
      .select("id, item_type, ingredient_id, sub_recipe_id, quantity, unit")
      .eq("recipe_id", recipe_id);

    const enrichedItems = await Promise.all(
      (items ?? []).map(async (it: any) => {
        if (it.item_type === "ingredient" && it.ingredient_id) {
          const [{ data: ing }, { data: cost }] = await Promise.all([
            supabase.from("ingredients").select("name, unit").eq("id", it.ingredient_id).maybeSingle(),
            supabase.rpc("ingredient_avg_cost_last_30d", { _ingredient_id: it.ingredient_id }),
          ]);
          const uc = Number(cost ?? 0);
          return {
            ...it,
            name: ing?.name ?? null,
            unit_cost: uc,
            line_cost: uc * Number(it.quantity),
          };
        }
        if (it.sub_recipe_id) {
          const [{ data: sub }, { data: subTotal }] = await Promise.all([
            supabase.from("recipes").select("name, yield_qty, yield_unit").eq("id", it.sub_recipe_id).maybeSingle(),
            supabase.rpc("recipe_total_cost", { _recipe_id: it.sub_recipe_id, _depth: 0 }),
          ]);
          const yq = Number(sub?.yield_qty ?? 1) || 1;
          const uc = Number(subTotal ?? 0) / yq;
          return {
            ...it,
            name: sub?.name ?? null,
            unit_cost: uc,
            line_cost: uc * Number(it.quantity),
          };
        }
        return { ...it, name: null, unit_cost: 0, line_cost: 0 };
      }),
    );

    const total_cost = enrichedItems.reduce((s, i: any) => s + Number(i.line_cost ?? 0), 0);
    const unit_cost = Number(recipe.yield_qty) > 0 ? total_cost / Number(recipe.yield_qty) : 0;

    const result = { recipe, items: enrichedItems, total_cost, unit_cost };
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      structuredContent: result,
    };
  },
});
