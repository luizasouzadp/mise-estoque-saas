import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "generate_management_report",
  title: "Relatório gerencial",
  description:
    "Gera relatório consolidado para o período: valor do estoque, top compras, top consumos, CMV (se houver), alertas de estoque e recomendações.",
  inputSchema: {
    period_start: z.string().describe("YYYY-MM-DD"),
    period_end: z.string().describe("YYYY-MM-DD"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ period_start, period_end }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const start = `${period_start}T00:00:00Z`;
    const end = `${period_end}T23:59:59Z`;

    const [
      { data: ings, error: e1 },
      { data: purchases },
      { data: outs },
      { data: cmv },
    ] = await Promise.all([
      supabase.from("ingredients").select("id, name, current_stock, min_stock, avg_cost, last_cost"),
      supabase
        .from("purchases")
        .select("ingredient_id, quantity, total_cost, supplier, ingredients!inner(name)")
        .gte("purchased_at", start)
        .lte("purchased_at", end),
      supabase
        .from("stock_movements")
        .select("ingredient_id, quantity, reason, ingredients!inner(name, avg_cost, last_cost, composes_cmv)")
        .eq("type", "out")
        .gte("occurred_at", start)
        .lte("occurred_at", end),
      supabase
        .from("cmv_reports")
        .select("*")
        .eq("period_start", period_start)
        .eq("period_end", period_end)
        .maybeSingle(),
    ]);
    if (e1) return err(e1.message);

    const inventoryValue = (ings ?? []).reduce((a, i) => {
      const c = Number(i.avg_cost) || Number(i.last_cost) || 0;
      return a + Number(i.current_stock) * c;
    }, 0);

    // Purchases aggregation
    type PR = { ingredient_id: string; quantity: number; total_cost: number; supplier: string | null; ingredients: { name: string } };
    const purAgg = new Map<string, { name: string; qty: number; cost: number }>();
    let totalPurchases = 0;
    const supplierAgg = new Map<string, number>();
    for (const p of (purchases ?? []) as unknown as PR[]) {
      totalPurchases += Number(p.total_cost);
      const cur = purAgg.get(p.ingredient_id) ?? { name: p.ingredients.name, qty: 0, cost: 0 };
      cur.qty += Number(p.quantity);
      cur.cost += Number(p.total_cost);
      purAgg.set(p.ingredient_id, cur);
      if (p.supplier) {
        supplierAgg.set(p.supplier, (supplierAgg.get(p.supplier) ?? 0) + Number(p.total_cost));
      }
    }

    // Consumption aggregation
    type OR = { ingredient_id: string; quantity: number; reason: string | null; ingredients: { name: string; avg_cost: number; last_cost: number; composes_cmv: boolean } };
    const consAgg = new Map<string, { name: string; qty: number; cost: number }>();
    let totalConsumptionCost = 0;
    for (const m of (outs ?? []) as unknown as OR[]) {
      if (m.reason?.toLowerCase().startsWith("inventário")) continue;
      if (!m.ingredients.composes_cmv) continue;
      const c = (Number(m.ingredients.avg_cost) || Number(m.ingredients.last_cost) || 0) * Number(m.quantity);
      totalConsumptionCost += c;
      const cur = consAgg.get(m.ingredient_id) ?? { name: m.ingredients.name, qty: 0, cost: 0 };
      cur.qty += Number(m.quantity);
      cur.cost += c;
      consAgg.set(m.ingredient_id, cur);
    }

    const alerts: string[] = [];
    const belowMin = (ings ?? []).filter((i) => Number(i.current_stock) < Number(i.min_stock)).length;
    const zeroed = (ings ?? []).filter((i) => Number(i.current_stock) <= 0).length;
    if (zeroed > 0) alerts.push(`${zeroed} insumos zerados.`);
    if (belowMin > 0) alerts.push(`${belowMin} insumos abaixo do mínimo.`);

    return ok({
      period: { start: period_start, end: period_end },
      inventory_value: Number(inventoryValue.toFixed(2)),
      purchases: {
        total: Number(totalPurchases.toFixed(2)),
        by_supplier: Array.from(supplierAgg.entries())
          .map(([supplier, total]) => ({ supplier, total: Number(total.toFixed(2)) }))
          .sort((a, b) => b.total - a.total),
        top_items: Array.from(purAgg.entries())
          .map(([id, v]) => ({
            ingredient_id: id,
            name: v.name,
            quantity: Number(v.qty.toFixed(3)),
            cost: Number(v.cost.toFixed(2)),
          }))
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 10),
      },
      consumption: {
        total_cost: Number(totalConsumptionCost.toFixed(2)),
        top_items: Array.from(consAgg.entries())
          .map(([id, v]) => ({
            ingredient_id: id,
            name: v.name,
            quantity: Number(v.qty.toFixed(3)),
            cost: Number(v.cost.toFixed(2)),
          }))
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 10),
      },
      cmv_report: cmv ?? null,
      alerts,
      below_minimum_count: belowMin,
      out_of_stock_count: zeroed,
    });
  },
});
