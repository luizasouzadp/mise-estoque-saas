import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";
import { dailyConsumption } from "../lib/consumption";
import { suggestPurchaseQty, DEFAULT_SAFETY_DAYS } from "../lib/forecast";
import { computeSchedule } from "../lib/supplier-schedule";

export default defineTool({
  name: "create_purchase_suggestion",
  title: "Sugestão de lista de compras",
  description:
    "Gera a lista de compras agrupada pelo fornecedor padrão de cada insumo. Quando o fornecedor tem agenda semanal (order_days/delivery_days), o horizonte de cobertura é calculado por fornecedor: cobre o consumo até a próxima entrega DEPOIS da mais próxima, evitando ruptura entre pedidos. Sem agenda cadastrada, usa horizon_days (padrão 15). Fallback de agrupamento: último fornecedor do histórico → 'Sem fornecedor'.",
  inputSchema: {
    horizon_days: z
      .number()
      .int()
      .min(1)
      .max(60)
      .optional()
      .describe("Horizonte padrão em dias (usado quando o fornecedor não tem agenda). Padrão 15."),
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
    const defaultHorizon = horizon_days ?? 15;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    const { data: ings, error } = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, min_stock, avg_cost, last_cost, default_supplier_id");
    if (error) return err(error.message);

    const { data: suppliersData } = await supabase
      .from("suppliers")
      .select("id, name, delivery_days, order_days, lead_time_days, min_order_value");
    type SupplierRow = {
      id: string;
      name: string;
      delivery_days: number[] | null;
      order_days: number[] | null;
      lead_time_days: number | null;
      min_order_value: number | null;
    };
    const suppliersById = new Map<string, SupplierRow>();
    for (const s of (suppliersData ?? []) as SupplierRow[]) suppliersById.set(s.id, s);

    // Fallback: último fornecedor do histórico por ingrediente (compat).
    const ids = (ings ?? []).map((i) => i.id);
    const { data: lastPurchases } = await supabase
      .from("purchases")
      .select("ingredient_id, supplier, purchased_at")
      .in("ingredient_id", ids)
      .order("purchased_at", { ascending: false });
    const lastSupplierName = new Map<string, string>();
    for (const p of lastPurchases ?? []) {
      if (!lastSupplierName.has(p.ingredient_id) && p.supplier) {
        lastSupplierName.set(p.ingredient_id, p.supplier);
      }
    }

    type Sug = {
      ingredient_id: string;
      name: string;
      unit: string;
      current_stock: number;
      min_stock: number;
      suggested_qty: number;
      estimated_cost: number;
      avg_daily: number;
      forecast_consumption: number;
      coverage_days: number;
      at_risk: boolean;
    };

    type GroupBucket = {
      supplier_id: string | null;
      supplier: string;
      order_days: number[] | null;
      delivery_days: number[] | null;
      lead_time_days: number | null;
      min_order_value: number | null;
      next_order_date: string | null;
      next_delivery_date: string | null;
      next_next_delivery_date: string | null;
      coverage_days: number;
      items: Sug[];
    };

    const groups = new Map<string, GroupBucket>();

    function bucketFor(ing: { id: string; default_supplier_id: string | null }): GroupBucket {
      const sup = ing.default_supplier_id ? suppliersById.get(ing.default_supplier_id) ?? null : null;
      const key = sup ? `sup:${sup.id}` : lastSupplierName.has(ing.id) ? `name:${lastSupplierName.get(ing.id)}` : "none";
      let g = groups.get(key);
      if (g) return g;
      if (sup) {
        const sched = computeSchedule(today, sup, defaultHorizon);
        g = {
          supplier_id: sup.id,
          supplier: sup.name,
          order_days: sup.order_days,
          delivery_days: sup.delivery_days,
          lead_time_days: sup.lead_time_days,
          min_order_value: sup.min_order_value,
          ...sched,
          items: [],
        };
      } else {
        g = {
          supplier_id: null,
          supplier: lastSupplierName.get(ing.id) ?? "Sem fornecedor",
          order_days: null,
          delivery_days: null,
          lead_time_days: null,
          min_order_value: null,
          next_order_date: null,
          next_delivery_date: null,
          next_next_delivery_date: null,
          coverage_days: defaultHorizon,
          items: [],
        };
      }
      groups.set(key, g);
      return g;
    }

    for (const i of ings ?? []) {
      const stock = Number(i.current_stock ?? 0);
      const min = Number(i.min_stock ?? 0);
      const bucket = bucketFor(i);
      const series = await dailyConsumption(supabase, i.id, 60);
      const s = suggestPurchaseQty(
        stock,
        min,
        series,
        bucket.coverage_days,
        safety_days ?? DEFAULT_SAFETY_DAYS,
      );
      if (s.suggested_qty <= 0) continue;
      const daysRemaining = s.avg_daily > 0 ? stock / s.avg_daily : Infinity;
      const atRisk = stock < min || daysRemaining < bucket.coverage_days;
      if (only_critical && !atRisk) continue;
      const cost = Number(i.avg_cost ?? 0) || Number(i.last_cost ?? 0);
      bucket.items.push({
        ingredient_id: i.id,
        name: i.name,
        unit: i.unit,
        current_stock: stock,
        min_stock: min,
        suggested_qty: s.suggested_qty,
        estimated_cost: Number((s.suggested_qty * cost).toFixed(2)),
        avg_daily: s.avg_daily,
        forecast_consumption: s.forecast_consumption,
        coverage_days: bucket.coverage_days,
        at_risk: atRisk,
      });
    }

    const grouped = Array.from(groups.values())
      .filter((g) => g.items.length > 0)
      .map((g) => ({
        ...g,
        subtotal: Number(g.items.reduce((a, b) => a + b.estimated_cost, 0).toFixed(2)),
        below_min_order:
          g.min_order_value !== null &&
          g.min_order_value > 0 &&
          g.items.reduce((a, b) => a + b.estimated_cost, 0) < g.min_order_value,
      }));
    const total = Number(grouped.reduce((a, b) => a + b.subtotal, 0).toFixed(2));
    const totalItems = grouped.reduce((a, g) => a + g.items.length, 0);

    const payload = {
      today: today.toISOString().slice(0, 10),
      default_horizon_days: defaultHorizon,
      total_estimated_cost: total,
      total_items: totalItems,
      groups: grouped,
    };
    return ok(payload, JSON.stringify(payload, null, 2));
  },
});
