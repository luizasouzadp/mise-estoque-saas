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
  name: "record_stock_movement",
  title: "Registrar movimentação de estoque",
  description:
    "Cria uma movimentação de estoque (entrada ou saída) para um insumo. Atualiza o estoque atual automaticamente via trigger. Use para ajustes, perdas ou consumos avulsos.",
  inputSchema: {
    ingredient_id: z.string().uuid().describe("ID do insumo (ingredients.id)."),
    type: z.enum(["in", "out"]).describe("'in' para entrada, 'out' para saída."),
    quantity: z.number().positive().describe("Quantidade movimentada na unidade base do insumo."),
    reason: z.string().trim().optional().describe("Motivo/observação da movimentação."),
    unit_cost: z.number().nonnegative().optional().describe("Custo unitário (apenas para entradas)."),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ ingredient_id, type, quantity, reason, unit_cost }, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Não autenticado" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data: prof } = await supabase
      .from("profiles")
      .select("restaurant_id")
      .eq("id", ctx.getUserId())
      .maybeSingle();
    if (!prof?.restaurant_id) {
      return { content: [{ type: "text", text: "Restaurante não encontrado" }], isError: true };
    }
    const { data, error } = await supabase
      .from("stock_movements")
      .insert({
        restaurant_id: prof.restaurant_id,
        ingredient_id,
        type,
        quantity,
        reason: reason ?? null,
        unit_cost: unit_cost ?? null,
      })
      .select()
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Movimentação registrada: ${JSON.stringify(data)}` }],
      structuredContent: { movement: data },
    };
  },
});
