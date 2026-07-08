import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";
import { dailyConsumption } from "../lib/consumption";
import { depletionForecast } from "../lib/forecast";

export default defineTool({
  name: "get_dashboard",
  title: "Dashboard executivo",
  description:
    "Resumo executivo do estoque: valor total, produtos críticos (abaixo do mínimo ou zerados), itens próximos da ruptura, estoque parado e consumo do período.",
  inputSchema: {
    period_days: z.number().int().min(7).max(90).optional().describe("Período para consumo (padrão 30)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ period_days }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const period = period_days ?? 30;

    const { data: ings, error } = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, min_stock, avg_cost, last_cost");
    if (error) return err(error.message);
    const list = ings ?? [];

    let totalValue = 0;
    const critical: { id: string; name: string; current_stock: number; min_stock: number }[] = [];
    const zeroed: { id: string; name: string }[] = [];
    for (const i of list) {
      const stock = Number(i.current_stock ?? 0);
      const cost = Number(i.avg_cost ?? 0) || Number(i.last_cost ?? 0);
      totalValue += stock * cost;
      if (stock <= 0) zeroed.push({ id: i.id, name: i.name });
      else if (stock < Number(i.min_stock ?? 0)) {
        critical.push({ id: i.id, name: i.name, current_stock: stock, min_stock: Number(i.min_stock) });
      }
    }

    // Dead stock (60d)
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - 60);
    const { data: recentMv } = await supabase
      .from("stock_movements")
      .select("ingredient_id, quantity, type, ingredients!inner(name, avg_cost, last_cost, composes_cmv)")
      .gte("occurred_at", cutoff.toISOString());
    const active = new Set((recentMv ?? []).map((m) => m.ingredient_id));
    const dead = list.filter((i) => !active.has(i.id) && Number(i.current_stock) > 0);
    const deadValue = dead.reduce(
      (a, i) => a + Number(i.current_stock) * (Number(i.avg_cost) || Number(i.last_cost) || 0),
      0,
    );

    // Period consumption
    const periodCutoff = new Date();
    periodCutoff.setUTCDate(periodCutoff.getUTCDate() - period);
    const { data: periodMv } = await supabase
      .from("stock_movements")
      .select("quantity, reason, ingredients!inner(avg_cost, last_cost, composes_cmv)")
      .eq("type", "out")
      .gte("occurred_at", periodCutoff.toISOString());
    type PM = { quantity: number; reason: string | null; ingredients: { avg_cost: number; last_cost: number; composes_cmv: boolean } };
    let periodConsumptionCost = 0;
    for (const m of (periodMv ?? []) as unknown as PM[]) {
      if (m.reason?.toLowerCase().startsWith("inventário")) continue;
      if (!m.ingredients.composes_cmv) continue;
      const c = Number(m.ingredients.avg_cost) || Number(m.ingredients.last_cost) || 0;
      periodConsumptionCost += Number(m.quantity) * c;
    }

    // Near depletion — sample top 40 items with some stock
    const sample = list.filter((i) => Number(i.current_stock) > 0).slice(0, 40);
    const nearDepletion: { id: string; name: string; days_remaining: number; risk: string }[] = [];
    for (const i of sample) {
      const series = await dailyConsumption(supabase, i.id, 30);
      const f = depletionForecast(Number(i.current_stock), series, 3);
      if (f.days_remaining != null && f.days_remaining <= 7) {
        nearDepletion.push({
          id: i.id,
          name: i.name,
          days_remaining: f.days_remaining,
          risk: f.risk,
        });
      }
    }
    nearDepletion.sort((a, b) => a.days_remaining - b.days_remaining);

    return ok({
      inventory_value: Number(totalValue.toFixed(2)),
      out_of_stock: zeroed,
      below_minimum: critical,
      near_depletion_7d: nearDepletion,
      dead_stock_60d: { count: dead.length, value: Number(deadValue.toFixed(2)) },
      period_days: period,
      period_consumption_cost: Number(periodConsumptionCost.toFixed(2)),
    });
  },
});
