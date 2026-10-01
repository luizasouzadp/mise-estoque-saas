import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";
import {
  dailyConsumptionAll,
  effectiveStockAll,
  emptySeries,
  fetchAll,
  isInternallyProduced,
  loadRecipeGraph,
  normalizeName,
} from "../lib/consumption";
import { suggestPurchaseQty, DEFAULT_SAFETY_DAYS } from "../lib/forecast";
import { computeSchedule } from "../lib/supplier-schedule";

type QueryResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export default defineTool({
  name: "create_purchase_suggestion",
  title: "Sugestão de lista de compras",
  description:
    "Gera a lista de compras agrupada por fornecedor cadastrado (supplier_id). Fornecedor de cada insumo: fornecedor padrão → fornecedor principal do insumo → último fornecedor do histórico de compras (nome resolvido para o cadastro) → 'Sem fornecedor'. Itens produzidos internamente (pré-preparos/resultado de ficha) ficam de fora. Para insumos usados em pré-preparos, usa estoque efetivo (estoque do insumo + estoque dos pré-preparos × quantidade na ficha) e consumo explodido das fichas. Quando o fornecedor tem agenda semanal (order_days/delivery_days), cobre o consumo até a próxima entrega DEPOIS da mais próxima; sem agenda, usa horizon_days (padrão 15).",
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

    type IngRow = {
      id: string;
      name: string;
      unit: string;
      category: string | null;
      source_recipe_id: string | null;
      current_stock: number | null;
      min_stock: number | null;
      avg_cost: number | null;
      last_cost: number | null;
      default_supplier_id: string | null;
    };
    type SupplierRow = {
      id: string;
      name: string;
      delivery_days: number[] | null;
      order_days: number[] | null;
      lead_time_days: number | null;
      min_order_value: number | null;
    };
    type PurchaseRow = { ingredient_id: string; supplier: string | null; purchased_at: string };
    type LinkRow = { ingredient_id: string; supplier_id: string; is_primary: boolean };

    let ings: IngRow[];
    let suppliers: SupplierRow[];
    let purchases: PurchaseRow[];
    let links: LinkRow[];
    let consumption: Map<string, ReturnType<typeof emptySeries>>;
    let effective: Map<string, number>;
    try {
      const graph = await loadRecipeGraph(supabase);
      effective = effectiveStockAll(graph);
      [ings, suppliers, purchases, links, consumption] = await Promise.all([
        fetchAll<IngRow>(
          (from, to) =>
            supabase
              .from("ingredients")
              .select(
                "id, name, unit, category, source_recipe_id, current_stock, min_stock, avg_cost, last_cost, default_supplier_id",
              )
              .eq("is_active", true)
              .order("id")
              .range(from, to) as unknown as QueryResult<IngRow>,
        ),
        fetchAll<SupplierRow>(
          (from, to) =>
            supabase
              .from("suppliers")
              .select("id, name, delivery_days, order_days, lead_time_days, min_order_value")
              .order("id")
              .range(from, to) as unknown as QueryResult<SupplierRow>,
        ),
        // Sem filtro por lista de ids (a URL ficaria grande demais); o RLS já limita ao restaurante.
        fetchAll<PurchaseRow>(
          (from, to) =>
            supabase
              .from("purchases")
              .select("ingredient_id, supplier, purchased_at")
              .not("supplier", "is", null)
              .order("purchased_at", { ascending: false })
              .order("id")
              .range(from, to) as unknown as QueryResult<PurchaseRow>,
        ),
        fetchAll<LinkRow>(
          (from, to) =>
            supabase
              .from("ingredient_suppliers")
              .select("ingredient_id, supplier_id, is_primary")
              .eq("is_primary", true)
              .order("ingredient_id")
              .order("supplier_id")
              .range(from, to) as unknown as QueryResult<LinkRow>,
        ),
        dailyConsumptionAll(supabase, 60, graph),
      ]);
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }

    const suppliersById = new Map(suppliers.map((s) => [s.id, s]));
    // Nomes do histórico → cadastro (ignora maiúsculas, acentos e pontuação).
    const supplierIdByName = new Map<string, string>();
    for (const s of suppliers) {
      const key = normalizeName(s.name);
      if (key && !supplierIdByName.has(key)) supplierIdByName.set(key, s.id);
    }
    const primarySupplier = new Map<string, string>();
    for (const l of links) if (!primarySupplier.has(l.ingredient_id)) primarySupplier.set(l.ingredient_id, l.supplier_id);
    const lastSupplierName = new Map<string, string>();
    for (const p of purchases) {
      if (!lastSupplierName.has(p.ingredient_id) && p.supplier?.trim()) {
        lastSupplierName.set(p.ingredient_id, p.supplier.trim());
      }
    }

    function resolveSupplier(ing: IngRow): { sup: SupplierRow | null; name: string | null; source: string } {
      const byDefault = ing.default_supplier_id ? suppliersById.get(ing.default_supplier_id) : undefined;
      if (byDefault) return { sup: byDefault, name: byDefault.name, source: "padrão" };
      const primaryId = primarySupplier.get(ing.id);
      const byPrimary = primaryId ? suppliersById.get(primaryId) : undefined;
      if (byPrimary) return { sup: byPrimary, name: byPrimary.name, source: "principal" };
      const histName = lastSupplierName.get(ing.id);
      if (histName) {
        const id = supplierIdByName.get(normalizeName(histName));
        const byHist = id ? suppliersById.get(id) : undefined;
        if (byHist) return { sup: byHist, name: byHist.name, source: "histórico" };
        return { sup: null, name: histName, source: "histórico (não cadastrado)" };
      }
      return { sup: null, name: null, source: "nenhum" };
    }

    type Sug = {
      ingredient_id: string;
      name: string;
      unit: string;
      current_stock: number;
      effective_stock: number;
      min_stock: number;
      suggested_qty: number;
      estimated_cost: number;
      avg_daily: number;
      forecast_consumption: number;
      coverage_days: number;
      at_risk: boolean;
      supplier_source: string;
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

    function bucketFor(sup: SupplierRow | null, name: string | null): GroupBucket {
      const key = sup ? `sup:${sup.id}` : name ? `name:${normalizeName(name)}` : "none";
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
          supplier: name ?? "Sem fornecedor",
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

    let skippedInternal = 0;
    for (const i of ings) {
      if (isInternallyProduced(i)) {
        skippedInternal++;
        continue;
      }
      const stock = Number(i.current_stock ?? 0);
      const effStock = effective.get(i.id) ?? stock;
      const min = Number(i.min_stock ?? 0);
      const { sup, name, source } = resolveSupplier(i);
      const bucket = bucketFor(sup, name);
      const series = consumption.get(i.id) ?? emptySeries(60);
      const s = suggestPurchaseQty(
        effStock,
        min,
        series,
        bucket.coverage_days,
        safety_days ?? DEFAULT_SAFETY_DAYS,
      );
      if (s.suggested_qty <= 0) continue;
      const daysRemaining = s.avg_daily > 0 ? effStock / s.avg_daily : Infinity;
      const atRisk = effStock < min || daysRemaining < bucket.coverage_days;
      if (only_critical && !atRisk) continue;
      const cost = Number(i.avg_cost ?? 0) || Number(i.last_cost ?? 0);
      bucket.items.push({
        ingredient_id: i.id,
        name: i.name,
        unit: i.unit,
        current_stock: stock,
        effective_stock: effStock,
        min_stock: min,
        suggested_qty: s.suggested_qty,
        estimated_cost: Number((s.suggested_qty * cost).toFixed(2)),
        avg_daily: s.avg_daily,
        forecast_consumption: s.forecast_consumption,
        coverage_days: bucket.coverage_days,
        at_risk: atRisk,
        supplier_source: source,
      });
    }

    const grouped = Array.from(groups.values())
      .filter((g) => g.items.length > 0)
      .map((g) => ({
        ...g,
        items: g.items.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        subtotal: Number(g.items.reduce((a, b) => a + b.estimated_cost, 0).toFixed(2)),
        below_min_order:
          g.min_order_value !== null &&
          g.min_order_value > 0 &&
          g.items.reduce((a, b) => a + b.estimated_cost, 0) < g.min_order_value,
      }))
      .sort((a, b) => {
        // Cadastrados primeiro, "Sem fornecedor" por último.
        const rank = (g: typeof a) => (g.supplier_id ? 0 : g.supplier === "Sem fornecedor" ? 2 : 1);
        return rank(a) - rank(b) || a.supplier.localeCompare(b.supplier, "pt-BR");
      });
    const total = Number(grouped.reduce((a, b) => a + b.subtotal, 0).toFixed(2));
    const totalItems = grouped.reduce((a, g) => a + g.items.length, 0);

    const payload = {
      today: today.toISOString().slice(0, 10),
      default_horizon_days: defaultHorizon,
      total_estimated_cost: total,
      total_items: totalItems,
      excluded_internal_items: skippedInternal,
      groups: grouped,
    };
    return ok(payload);
  },
});
