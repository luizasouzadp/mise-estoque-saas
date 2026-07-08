import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "get_stock_movements",
  title: "Histórico de movimentações",
  description:
    "Retorna as movimentações de estoque de um ingrediente, com filtros opcionais de tipo e período.",
  inputSchema: {
    ingredient_id: z.string().uuid(),
    type: z.enum(["in", "out"]).optional(),
    since: z.string().datetime().optional().describe("ISO datetime inicial."),
    until: z.string().datetime().optional().describe("ISO datetime final."),
    limit: z.number().int().min(1).max(500).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ ingredient_id, type, since, until, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("stock_movements")
      .select("id, type, quantity, unit_cost, reason, notes, occurred_at")
      .eq("ingredient_id", ingredient_id)
      .order("occurred_at", { ascending: false })
      .limit(limit ?? 200);
    if (type) q = q.eq("type", type);
    if (since) q = q.gte("occurred_at", since);
    if (until) q = q.lte("occurred_at", until);
    const { data, error } = await q;
    if (error) return err(error.message);
    return ok({ count: (data ?? []).length, movements: data ?? [] });
  },
});
