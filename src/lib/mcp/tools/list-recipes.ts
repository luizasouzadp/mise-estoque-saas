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
  name: "list_recipes",
  title: "Listar fichas técnicas",
  description:
    "Lista as fichas técnicas (receitas) do restaurante com nome, rendimento, custo total e custo unitário calculados a partir dos insumos.",
  inputSchema: {
    search: z.string().trim().optional().describe("Filtro por nome."),
    on_menu_only: z.boolean().optional().describe("Se true, retorna apenas fichas do cardápio."),
    limit: z.number().int().min(1).max(200).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, on_menu_only, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("recipes")
      .select("id, name, yield_qty, yield_unit, is_on_menu, menu_category, current_price")
      .order("name")
      .limit(limit ?? 100);
    if (search) q = q.ilike("name", `%${search}%`);
    if (on_menu_only) q = q.eq("is_on_menu", true);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };

    const enriched = await Promise.all(
      (data ?? []).map(async (r: any) => {
        const [{ data: total }, { data: unit }] = await Promise.all([
          supabase.rpc("recipe_total_cost", { _recipe_id: r.id, _depth: 0 }),
          supabase.rpc("recipe_unit_cost", { _recipe_id: r.id }),
        ]);
        const unitCost = Number(unit ?? 0);
        const price = r.current_price != null ? Number(r.current_price) : null;
        const cmv_pct = price && price > 0 ? (unitCost / price) * 100 : null;
        return {
          ...r,
          total_cost: Number(total ?? 0),
          unit_cost: unitCost,
          cmv_pct,
        };
      }),
    );

    return {
      content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }],
      structuredContent: { items: enriched },
    };
  },
});
