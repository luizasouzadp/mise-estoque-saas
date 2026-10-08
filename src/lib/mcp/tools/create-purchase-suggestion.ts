import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, getClosedWeekdays, notAuthed, err, ok } from "../lib/supabase-for-user";
import {
  dailyConsumptionAll,
  effectiveStockAll,
  fetchAll,
  internalReason,
  loadRecipeGraph,
  normalizeName,
} from "../lib/consumption";
import { toIngredientUnit, type PackInfo, type UnitAlias } from "../lib/packs";
import {
  avgPerOpenDay,
  decideItem,
  fillToMinimum,
  nextOrderPreview,
  supplierSchedule,
  type ItemDecision,
  type PlannerItem,
  type PlannerSupplier,
} from "../lib/purchase-planner";

type QueryResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

// Consumo médio diário = últimas 4 semanas (contagens de domingo).
const CONSUMPTION_DAYS = 28;

// YYYY-MM-DD no fuso do restaurante (Brasil).
function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function dateSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

export default defineTool({
  name: "create_purchase_suggestion",
  title: "Lista de compras automática",
  description: [
    "Gera a lista de compras por fornecedor: se é preciso pedir agora e quanto, com a regra 'o pedido de hoje precisa durar até a entrega do próximo pedido'.",
    "Consumo diário = média das últimas 4 semanas (contagens), com as fichas explodidas até o insumo comprado.",
    "Estoque disponível = estoque efetivo (inclui pré-preparos pela ficha) − consumo médio × dias desde a última contagem + encomendas pendentes que chegam até o fim da cobertura (on_order).",
    "Prazo = dias do pedido até a entrega (primeiro dia de entrega depois do pedido; sem dia fixo, lead_time_days).",
    "Pede se o disponível não chega até a entrega do próximo pedido possível (intervalo possível) + safety_days, ou se vai ficar abaixo do mínimo antes disso.",
    "Quantidade = consumo × max(prazo + intervalo preferido, cobertura mínima) + mínimo − disponível, arredondada PARA CIMA pela embalagem de compra (qty, packs, pack_name). Cada item traz decision_reason.",
    "Por fornecedor: missing_to_min_order e fill_suggestions (itens para completar o pedido mínimo); quinzenais/mensais trazem next_order_preview.",
    "Ficam fora: insumos e fornecedores inativos e itens produzidos internamente (pré-preparos).",
  ].join(" "),
  inputSchema: {
    as_of_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional()
      .describe("Data de referência YYYY-MM-DD (padrão: hoje). Útil para prévias de outros dias."),
    supplier_ids: z
      .array(z.string().uuid())
      .max(100)
      .optional()
      .describe("Só estes fornecedores (ex.: os do lembrete do dia)."),
    horizon_days: z
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .describe("Cobertura para fornecedores sem frequência nem dias de pedido (padrão 15)."),
    only_critical: z
      .boolean()
      .optional()
      .describe(
        "Se true, só os fornecedores com algo a pedir agora. A decisão de pedir é a mesma do campo order de cada item.",
      ),
    safety_days: z
      .number()
      .int()
      .min(0)
      .max(30)
      .optional()
      .describe("Sobrescreve a margem de segurança de todos os fornecedores (padrão: a de cada um, 2)."),
    include_waiting: z
      .boolean()
      .optional()
      .describe("Padrão true: lista também os itens que podem esperar, com o motivo."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (
    { as_of_date, supplier_ids, horizon_days, only_critical, safety_days, include_waiting },
    ctx,
  ) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const asOf = as_of_date ?? todaySaoPaulo();
    const defaultHorizon = horizon_days ?? 15;
    const showWaiting = include_waiting ?? true;

    // Dias em que o restaurante fecha (não consomem estoque).
    const closedWeekdays = await getClosedWeekdays(supabase, ctx.getUserId());

    type IngRow = {
      id: string;
      name: string;
      unit: string;
      category: string | null;
      source_recipe_id: string | null;
      is_active: boolean;
      current_stock: number | null;
      min_stock: number | null;
      avg_cost: number | null;
      last_cost: number | null;
      default_supplier_id: string | null;
      purchase_pack_qty: number | null;
      purchase_pack_name: string | null;
    };
    type SupplierRow = {
      id: string;
      name: string;
      delivery_days: number[] | null;
      order_days: number[] | null;
      lead_time_days: number | null;
      min_order_value: number | null;
      order_frequency: string | null;
      order_interval_days: number | null;
      possible_interval_days: number | null;
      min_coverage_days: number | null;
      safety_days: number | null;
      is_active: boolean | null;
    };
    type PurchaseRow = { ingredient_id: string; supplier: string | null };
    type LinkRow = { ingredient_id: string; supplier_id: string };
    type OrderRow = {
      ingredient_id: string;
      quantity: number;
      unit: string | null;
      expected_at: string | null;
    };
    type AliasRow = UnitAlias & { ingredient_id: string };
    type CountRow = {
      ingredient_id: string;
      inventories: { last_completed_at: string | null; completed_at: string | null } | null;
    };

    let ings: IngRow[];
    let suppliers: SupplierRow[];
    let purchases: PurchaseRow[];
    let links: LinkRow[];
    let pendingOrders: OrderRow[];
    let counts: CountRow[];
    let aliases: AliasRow[];
    let consumption: Awaited<ReturnType<typeof dailyConsumptionAll>>;
    let effective: Map<string, number>;
    let graph: Awaited<ReturnType<typeof loadRecipeGraph>>;
    try {
      graph = await loadRecipeGraph(supabase);
      effective = effectiveStockAll(graph);
      [ings, suppliers, purchases, links, pendingOrders, counts, aliases, consumption] = await Promise.all([
        fetchAll<IngRow>(
          (from, to) =>
            supabase
              .from("ingredients")
              .select(
                "id, name, unit, category, source_recipe_id, is_active, current_stock, min_stock, avg_cost, last_cost, default_supplier_id, purchase_pack_qty, purchase_pack_name",
              )
              .order("id")
              .range(from, to) as unknown as QueryResult<IngRow>,
        ),
        fetchAll<SupplierRow>(
          (from, to) =>
            supabase
              .from("suppliers")
              .select(
                "id, name, delivery_days, order_days, lead_time_days, min_order_value, order_frequency, order_interval_days, possible_interval_days, min_coverage_days, safety_days, is_active",
              )
              .order("id")
              .range(from, to) as unknown as QueryResult<SupplierRow>,
        ),
        // Sem filtro por lista de ids (a URL ficaria grande demais); o RLS já limita ao restaurante.
        fetchAll<PurchaseRow>(
          (from, to) =>
            supabase
              .from("purchases")
              .select("ingredient_id, supplier")
              .not("supplier", "is", null)
              .order("purchased_at", { ascending: false })
              .order("id")
              .range(from, to) as unknown as QueryResult<PurchaseRow>,
        ),
        fetchAll<LinkRow>(
          (from, to) =>
            supabase
              .from("ingredient_suppliers")
              .select("ingredient_id, supplier_id")
              .eq("is_primary", true)
              .order("ingredient_id")
              .order("supplier_id")
              .range(from, to) as unknown as QueryResult<LinkRow>,
        ),
        fetchAll<OrderRow>(
          (from, to) =>
            supabase
              .from("purchase_orders")
              .select("ingredient_id, quantity, unit, expected_at")
              .eq("status", "pending")
              .order("id")
              .range(from, to) as unknown as QueryResult<OrderRow>,
        ),
        fetchAll<CountRow>(
          (from, to) =>
            supabase
              .from("inventory_items")
              .select("ingredient_id, inventories!inner(last_completed_at, completed_at)")
              .order("id")
              .range(from, to) as unknown as QueryResult<CountRow>,
        ),
        // Conversões memorizadas na entrada de nota (1 CX = 30 kg).
        fetchAll<AliasRow>(
          (from, to) =>
            supabase
              .from("ingredient_unit_aliases")
              .select("ingredient_id, from_unit, factor")
              .order("id")
              .range(from, to) as unknown as QueryResult<AliasRow>,
        ),
        dailyConsumptionAll(supabase, CONSUMPTION_DAYS, graph),
      ]);
    } catch (e) {
      return err(e instanceof Error ? e.message : String(e));
    }

    // ---------- Fornecedor de cada insumo ----------
    const suppliersById = new Map(suppliers.map((s) => [s.id, s]));
    const isActiveSupplier = (s: SupplierRow | undefined) => !!s && s.is_active !== false;
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
    // Ordem: padrão → principal → último do histórico (nome resolvido para o cadastro).
    // Fornecedor inativo é pulado; se só sobrar ele, o item fica fora da lista.
    function resolveSupplier(
      ing: IngRow,
    ): { sup: SupplierRow | null; name: string | null; source: string } | null {
      let sawInactive = false;
      for (const [id, source] of [
        [ing.default_supplier_id, "padrão"],
        [primarySupplier.get(ing.id), "principal"],
      ] as const) {
        const s = id ? suppliersById.get(id) : undefined;
        if (!s) continue;
        if (isActiveSupplier(s)) return { sup: s, name: s.name, source };
        sawInactive = true;
      }
      const histName = lastSupplierName.get(ing.id);
      if (histName) {
        const id = supplierIdByName.get(normalizeName(histName));
        const s = id ? suppliersById.get(id) : undefined;
        if (s && isActiveSupplier(s)) return { sup: s, name: s.name, source: "histórico" };
        if (s) sawInactive = true;
        else if (!sawInactive) return { sup: null, name: histName, source: "histórico (não cadastrado)" };
      }
      if (sawInactive) return null;
      return { sup: null, name: null, source: "nenhum" };
    }

    // ---------- Dados por insumo ----------
    const ingById = new Map(ings.map((i) => [i.id, i]));
    const lastCount = new Map<string, string>();
    for (const c of counts) {
      const at = c.inventories?.last_completed_at ?? c.inventories?.completed_at;
      if (!at) continue;
      const d = dateSaoPaulo(at);
      if (d > asOf) continue;
      const prev = lastCount.get(c.ingredient_id);
      if (!prev || d > prev) lastCount.set(c.ingredient_id, d);
    }
    const aliasesByIng = new Map<string, UnitAlias[]>();
    for (const a of aliases) {
      const list = aliasesByIng.get(a.ingredient_id) ?? [];
      list.push(a);
      aliasesByIng.set(a.ingredient_id, list);
    }
    const ordersByIng = new Map<string, { qty: number; expected_at: string | null }[]>();
    const unitWarnings: string[] = [];
    for (const o of pendingOrders) {
      const ing = ingById.get(o.ingredient_id);
      if (!ing) continue;
      const conv = toIngredientUnit(Number(o.quantity ?? 0), o.unit, ing, aliasesByIng.get(ing.id));
      if (conv.converted_by === "unknown") {
        unitWarnings.push(
          `${ing.name}: encomenda em "${o.unit}" não converte para ${ing.unit}; usada como ${ing.unit}. Cadastre a embalagem no insumo (ou memorize a conversão na entrada de nota) para converter.`,
        );
      }
      const list = ordersByIng.get(o.ingredient_id) ?? [];
      list.push({ qty: conv.qty, expected_at: o.expected_at ? o.expected_at.slice(0, 10) : null });
      ordersByIng.set(o.ingredient_id, list);
    }

    // ---------- Agrupa por fornecedor ----------
    type Group = { key: string; supplier: PlannerSupplier; items: PlannerItem[]; sources: Map<string, string> };
    const groups = new Map<string, Group>();
    const noConsumption: string[] = [];
    const excludedInternal: { name: string; reason: string }[] = [];
    const excludedInactiveSupplier: string[] = [];
    for (const i of ings) {
      if (i.is_active === false) continue;
      const internal = internalReason(i, graph);
      if (internal) {
        excludedInternal.push({ name: i.name, reason: internal });
        continue;
      }
      const res = resolveSupplier(i);
      if (!res) {
        excludedInactiveSupplier.push(i.name);
        continue;
      }
      const { sup, name, source } = res;
      if (supplier_ids?.length && (!sup || !supplier_ids.includes(sup.id))) continue;
      const key = sup ? `sup:${sup.id}` : name ? `name:${normalizeName(name)}` : "none";
      let g = groups.get(key);
      if (!g) {
        g = {
          key,
          supplier: sup
            ? {
                id: sup.id,
                name: sup.name,
                order_days: sup.order_days,
                delivery_days: sup.delivery_days,
                lead_time_days: sup.lead_time_days,
                order_frequency: sup.order_frequency,
                preferred_interval_days: sup.order_interval_days,
                possible_interval_days: sup.possible_interval_days,
                min_coverage_days: sup.min_coverage_days,
                safety_days: sup.safety_days,
                min_order_value: sup.min_order_value,
              }
            : {
                id: null,
                name: name ?? "Sem fornecedor",
                order_days: null,
                delivery_days: null,
                lead_time_days: null,
                order_frequency: null,
                preferred_interval_days: null,
                possible_interval_days: null,
                min_coverage_days: null,
                safety_days: null,
                min_order_value: null,
              },
          items: [],
          sources: new Map(),
        };
        groups.set(key, g);
      }
      const series = consumption.get(i.id);
      // Consumo da janela ÷ dias ABERTOS da janela.
      const avg = series ? avgPerOpenDay(series.slice(-CONSUMPTION_DAYS), closedWeekdays) : 0;
      const stock = Number(i.current_stock ?? 0);
      const min = Number(i.min_stock ?? 0);
      if (avg <= 0 && min <= 0) noConsumption.push(i.name);
      g.items.push({
        ingredient_id: i.id,
        name: i.name,
        unit: i.unit,
        purchase_pack_qty: i.purchase_pack_qty,
        purchase_pack_name: i.purchase_pack_name,
        avg_daily: avg,
        current_stock: stock,
        effective_stock: effective.get(i.id) ?? stock,
        last_count_date: lastCount.get(i.id) ?? null,
        min_stock: min,
        unit_cost: Number(i.avg_cost ?? 0) || Number(i.last_cost ?? 0),
        orders: ordersByIng.get(i.id) ?? [],
      });
      g.sources.set(i.id, source);
    }

    // ---------- Decide por fornecedor ----------
    type OutGroup = Record<string, unknown> & {
      supplier_id: string | null;
      supplier: string;
      order_now: boolean;
      subtotal: number;
      items: unknown[];
    };
    const out: OutGroup[] = [];
    for (const g of groups.values()) {
      const sch = supplierSchedule(g.supplier, asOf, defaultHorizon, safety_days, closedWeekdays);
      const decisions = new Map<string, ItemDecision>();
      for (const item of g.items) decisions.set(item.ingredient_id, decideItem(item, sch));
      const all = Array.from(decisions.values());
      // Todo item fica em items (pedir) ou em waiting (esperar), nunca some.
      const toOrder = all
        .filter((d) => d.order)
        .sort((a, b) => (a.days_until_out ?? Infinity) - (b.days_until_out ?? Infinity));
      if (only_critical && !toOrder.length) continue;
      const waiting = all
        .filter((d) => !d.order)
        .sort((a, b) => (a.days_until_out ?? Infinity) - (b.days_until_out ?? Infinity));

      const subtotal = Number(toOrder.reduce((a, d) => a + d.estimated_cost, 0).toFixed(2));
      const minOrder = Number(g.supplier.min_order_value ?? 0);
      const missing = toOrder.length && minOrder > 0 ? Math.max(0, Number((minOrder - subtotal).toFixed(2))) : null;
      const packInfo = new Map<string, PackInfo>(g.items.map((i) => [i.ingredient_id, i]));
      const fill = missing ? fillToMinimum(missing, all, packInfo) : [];

      const preferred = sch.preferred_interval_days ?? 0;
      const preview =
        g.supplier.id && (g.supplier.order_frequency === "biweekly" || g.supplier.order_frequency === "monthly" || preferred >= 14)
          ? nextOrderPreview(g.supplier, sch, g.items, decisions, defaultHorizon)
          : null;

      out.push({
        supplier_id: g.supplier.id,
        supplier: g.supplier.name,
        order_frequency: g.supplier.order_frequency,
        order_days: g.supplier.order_days,
        delivery_days: g.supplier.delivery_days,
        min_coverage_days: g.supplier.min_coverage_days,
        min_order_value: g.supplier.min_order_value,
        ...sch,
        order_now: toOrder.length > 0,
        items: toOrder.map((d) => ({ ...d, supplier_source: g.sources.get(d.ingredient_id) })),
        subtotal,
        missing_to_min_order: missing,
        fill_suggestions: fill,
        fill_total: Number(fill.reduce((a, f) => a + f.add_cost, 0).toFixed(2)),
        waiting: showWaiting
          ? waiting.map((d) => ({
              ingredient_id: d.ingredient_id,
              name: d.name,
              unit: d.unit,
              available_stock: d.available_stock,
              on_order: d.on_order,
              avg_daily: d.avg_daily,
              min_stock: d.min_stock,
              days_until_out: d.days_until_out,
              depletion_date: d.depletion_date,
              decision_reason: d.decision_reason,
            }))
          : undefined,
        next_order_preview: preview,
      });
    }

    out.sort((a, b) => {
      // Quem tem pedido primeiro; cadastrados antes; "Sem fornecedor" por último.
      const rank = (g: OutGroup) =>
        (g.order_now ? 0 : 10) + (g.supplier_id ? 0 : g.supplier === "Sem fornecedor" ? 2 : 1);
      return rank(a) - rank(b) || a.supplier.localeCompare(b.supplier, "pt-BR");
    });

    const ordering = out.filter((g) => g.order_now);
    return ok({
      as_of_date: asOf,
      consumption_window_days: CONSUMPTION_DAYS,
      closed_weekdays: closedWeekdays,
      default_horizon_days: defaultHorizon,
      total_estimated_cost: Number(ordering.reduce((a, g) => a + g.subtotal, 0).toFixed(2)),
      suppliers_to_order: ordering.map((g) => g.supplier),
      total_items: ordering.reduce((a, g) => a + g.items.length, 0),
      excluded_internal_items: excludedInternal.length,
      excluded_inactive_supplier_items: excludedInactiveSupplier.length,
      excluded: {
        internal: excludedInternal.sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
        inactive_supplier: excludedInactiveSupplier.sort((a, b) => a.localeCompare(b, "pt-BR")),
      },
      attention: {
        no_consumption_and_no_minimum: noConsumption.sort((a, b) => a.localeCompare(b, "pt-BR")),
        order_unit_warnings: unitWarnings,
      },
      groups: out,
    });
  },
});
