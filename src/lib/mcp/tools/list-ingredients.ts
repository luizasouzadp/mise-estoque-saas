import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { cleanNumbers } from "../lib/supabase-for-user";

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
    "Lista os insumos ativos do restaurante do usuário autenticado, com estoque atual, mínimo, unidade, categoria, custo médio/último, fornecedor padrão (quando definido) e embalagem de compra (purchase_pack_qty na unidade do insumo, purchase_pack_name). Aceita busca por nome e filtro opcional apenas de itens em baixo estoque. O parâmetro limit é opcional; quando low_stock_only=true o teto padrão é 500 para não recortar a lista de itens críticos.",
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
      .select(
        "id, name, unit, category, current_stock, min_stock, avg_cost, last_cost, composes_cmv, purchase_pack_qty, purchase_pack_name, default_supplier_id, default_supplier:suppliers!ingredients_default_supplier_id_fkey(id, name)",
      )
      .eq("is_active", true)
      .order("name")
      // O banco não compara duas colunas pela API; com low_stock_only o filtro
      // é feito aqui, então buscamos todos os ativos antes de aplicar o limite.
      .limit(low_stock_only ? 5000 : effectiveLimit);
    if (search) q = q.ilike("name", `%${search}%`);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    const filtered = low_stock_only
      ? (data ?? [])
          .filter((r) => Number(r.current_stock ?? 0) < Number(r.min_stock ?? 0))
          .slice(0, effectiveLimit)
      : (data ?? []);
    const rows = cleanNumbers(filtered);
    return {
      content: [{ type: "text", text: JSON.stringify(rows, null, 2) }],
      structuredContent: { items: rows },
    };
  },
});
