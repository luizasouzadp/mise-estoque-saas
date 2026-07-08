import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";
import { dailyConsumption } from "../lib/consumption";
import { suggestPurchaseQty, DEFAULT_SAFETY_DAYS } from "../lib/forecast";

export default defineTool({
  name: "create_purchase_suggestion",
  title: "Sugestão de lista de compras",
  description:
    "Gera automaticamente uma sugestão de lista de compras para todos os insumos em risco de ruptura no horizonte informado, agrupada pelo último fornecedor de cada item.",
  inputSchema: {
    horizon_days: z.number().int().min(1).max(60).optional().describe("Padrão 15."),
    only_critical: z
      .boolean()
      .optional()
      .describe("Se true, apenas itens abaixo do mínimo ou com risco de ruptura no horizonte."),
    safety_days: z.number().int().min(0).max(30).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ horizon_days, only_critical, safety_days }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const horizon = horizon_days ?? 15;
    const { data: ings, error } = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, min_stock, avg_cost, last_cost");
    if (error) return err(error.message);

    type Sug = {
      ingredient_id: string;
      name: string;
      unit: string;
      current_stock: number;
      suggested_qty: number;
      estimated_cost: number;
      preferred_supplier: string | null;
      avg_daily: number;
      forecast_consumption: number;
    };
    const suggestions: Sug[] = [];
    // Fetch last supplier per ingredient in one shot for reasonable set
    const ids = (ings ?? []).map((i) => i.id);
    const { data: lastPurchases } = await supabase
      .from("purchases")
      .select("ingredient_id, supplier, purchased_at")
      .in("ingredient_id", ids)
      .order("purchased_at", { ascending: false });
    const preferred = new Map<string, string>();
    for (const p of lastPurchases ?? []) {
      if (!preferred.has(p.ingredient_id) && p.supplier) {
        preferred.set(p.ingredient_id, p.supplier);
      }
    }

    for (const i of ings ?? []) {
      const stock = Number(i.current_stock ?? 0);
      const min = Number(i.min_stock ?? 0);
      const series = await dailyConsumption(supabase, i.id, 60);
      const s = suggestPurchaseQty(stock, min, series, horizon, safety_days ?? DEFAULT_SAFETY_DAYS);
      if (s.suggested_qty <= 0) continue;
      if (only_critical && !(stock < min || s.avg_daily * horizon > stock)) continue;
      const cost = Number(i.avg_cost ?? 0) || Number(i.last_cost ?? 0);
      suggestions.push({
        ingredient_id: i.id,
        name: i.name,
        unit: i.unit,
        current_stock: stock,
        suggested_qty: s.suggested_qty,
        estimated_cost: Number((s.suggested_qty * cost).toFixed(2)),
        preferred_supplier: preferred.get(i.id) ?? null,
        avg_daily: s.avg_daily,
        forecast_consumption: s.forecast_consumption,
      });
    }

    const bySupplier = new Map<string, Sug[]>();
    for (const s of suggestions) {
      const k = s.preferred_supplier ?? "Sem fornecedor";
      const arr = bySupplier.get(k) ?? [];
      arr.push(s);
      bySupplier.set(k, arr);
    }
    const grouped = Array.from(bySupplier.entries()).map(([supplier, items]) => ({
      supplier,
      items,
      subtotal: Number(items.reduce((a, b) => a + b.estimated_cost, 0).toFixed(2)),
    }));
    const total = Number(grouped.reduce((a, b) => a + b.subtotal, 0).toFixed(2));
    return ok(
      { horizon_days: horizon, total_estimated_cost: total, groups: grouped },
      `Sugestão de compras: ${suggestions.length} itens · R$ ${total.toFixed(2)} estimados.`,
    );
  },
});
