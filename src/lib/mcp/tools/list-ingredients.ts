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
  name: "list_ingredients",
  title: "Listar insumos",
  description:
    "Lista os insumos do restaurante do usuário autenticado, com estoque atual, mínimo, unidade, categoria e custo médio/último. Aceita busca por nome e filtro opcional apenas de itens em baixo estoque (aplicado no banco). O parâmetro limit é opcional; quando low_stock_only=true o teto padrão é 500 para não recortar a lista de itens críticos.",
  inputSchema: {
    search: z.string().trim().optional().describe("Filtro por nome (case-insensitive)."),
    low_stock_only: z
      .boolean()
      .optional()
      .describe("Se true, retorna apenas insumos com estoque atual abaixo do mínimo."),
    limit: z.number().int().min(1).max(500).optional().describe("Máximo de itens (padrão 100; 500 quando low_stock_only=true)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ search, low_stock_only, limit }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const effectiveLimit = limit ?? (low_stock_only ? 500 : 100);
    let q = supabase
      .from("ingredients")
      .select("id, name, unit, category, current_stock, min_stock, avg_cost, last_cost, composes_cmv")
      .order("name")
      .limit(effectiveLimit);
    if (search) q = q.ilike("name", `%${search}%`);
    if (low_stock_only) q = q.filter("current_stock", "lt", "min_stock");
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const rows = data ?? [];
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { items: rows },
    };
  },
});
