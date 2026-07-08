import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "calculate_cmv",
  title: "CMV do período",
  description:
    "Retorna o CMV (Custo da Mercadoria Vendida) do período. Se houver cmv_report cadastrado, usa o existente; caso contrário calcula on-the-fly usando as saídas de estoque (excluindo ajustes de inventário) × custo médio.",
  inputSchema: {
    period_start: z.string().describe("YYYY-MM-DD"),
    period_end: z.string().describe("YYYY-MM-DD"),
    revenue: z.number().nonnegative().optional().describe("Receita do período para calcular %CMV."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ period_start, period_end, revenue }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    // Try existing report
    const { data: existing } = await supabase
      .from("cmv_reports")
      .select("*")
      .eq("period_start", period_start)
      .eq("period_end", period_end)
      .maybeSingle();
    if (existing) {
      return ok({ source: "cmv_reports", report: existing });
    }
    // Compute
    const { data: mv, error } = await supabase
      .from("stock_movements")
      .select("ingredient_id, quantity, reason, ingredients!inner(name, avg_cost, last_cost, composes_cmv)")
      .eq("type", "out")
      .gte("occurred_at", `${period_start}T00:00:00Z`)
      .lte("occurred_at", `${period_end}T23:59:59Z`);
    if (error) return err(error.message);
    type Row = {
      ingredient_id: string;
      quantity: number;
      reason: string | null;
      ingredients: { name: string; avg_cost: number; last_cost: number; composes_cmv: boolean };
    };
    let totalCost = 0;
    const byIng = new Map<string, { name: string; qty: number; cost: number }>();
    for (const r of (mv ?? []) as unknown as Row[]) {
      if (r.reason?.toLowerCase().startsWith("inventário")) continue;
      if (!r.ingredients.composes_cmv) continue;
      const unitCost = Number(r.ingredients.avg_cost) || Number(r.ingredients.last_cost) || 0;
      const c = Number(r.quantity) * unitCost;
      totalCost += c;
      const cur = byIng.get(r.ingredient_id) ?? { name: r.ingredients.name, qty: 0, cost: 0 };
      cur.qty += Number(r.quantity);
      cur.cost += c;
      byIng.set(r.ingredient_id, cur);
    }
    const top = Array.from(byIng.entries())
      .map(([id, v]) => ({
        ingredient_id: id,
        name: v.name,
        quantity_consumed: Number(v.qty.toFixed(3)),
        cost: Number(v.cost.toFixed(2)),
      }))
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 20);
    return ok({
      source: "computed",
      period_start,
      period_end,
      total_cost: Number(totalCost.toFixed(2)),
      revenue: revenue ?? null,
      cmv_percent: revenue && revenue > 0 ? Number(((totalCost / revenue) * 100).toFixed(2)) : null,
      top_impacts: top,
    });
  },
});
