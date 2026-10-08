import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, getClosedWeekdays, notAuthed, err, ok } from "../lib/supabase-for-user";
import { dailyConsumption, effectiveStock } from "../lib/consumption";
import { DEFAULT_SAFETY_DAYS } from "../lib/forecast";
import { seasonalityByDow } from "../lib/stats";
import { orderText, roundToPack, toIngredientUnit } from "../lib/packs";
import {
  avgPerOpenDay,
  decideItem,
  isoDate,
  parseDate,
  type Schedule,
} from "../lib/purchase-planner";

// Mesma janela da lista de compras: últimas 4 semanas.
const CONSUMPTION_DAYS = 28;

function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}
function dateSaoPaulo(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
}

export default defineTool({
  name: "suggest_purchase_quantity",
  title: "Sugerir quantidade de compra",
  description:
    "Sugere quanto comprar de um insumo para cobrir um horizonte (padrão 15 dias), com a mesma regra da lista de compras: consumo médio por dia ABERTO das últimas 4 semanas (dias fechados do restaurante não consomem), estoque disponível = estoque efetivo − consumo dos dias abertos desde a última contagem + encomendas pendentes; quantidade = max(consumo dos dias abertos do horizonte − disponível, mínimo − disponível, 0), arredondada pela embalagem de compra. Para o pedido por fornecedor, prefira create_purchase_suggestion.",
  inputSchema: {
    ingredient_id: z.string().uuid(),
    horizon_days: z.number().int().min(1).max(90).optional().describe("Dias de cobertura. Padrão 15."),
    safety_days: z.number().int().min(0).max(30).optional(),
    use_weekday_seasonality: z
      .boolean()
      .optional()
      .describe(
        "Padrão false: consumo médio por dia aberto. Ligue só quando o consumo for lançado diariamente (ex.: vendas do Saipos).",
      ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ ingredient_id, horizon_days, safety_days, use_weekday_seasonality }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data: ing, error } = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, min_stock, avg_cost, last_cost, purchase_pack_qty, purchase_pack_name")
      .eq("id", ingredient_id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!ing) return err("Insumo não encontrado.");

    const asOf = todaySaoPaulo();
    const horizon = horizon_days ?? 15;
    const safety = safety_days ?? DEFAULT_SAFETY_DAYS;
    const [closed, effStockRaw, series, counts, pending, aliasRes] = await Promise.all([
      getClosedWeekdays(supabase, ctx.getUserId()),
      effectiveStock(supabase, ingredient_id),
      dailyConsumption(supabase, ingredient_id, CONSUMPTION_DAYS),
      supabase
        .from("inventory_items")
        .select("inventories!inner(last_completed_at, completed_at)")
        .eq("ingredient_id", ingredient_id),
      supabase
        .from("purchase_orders")
        .select("quantity, unit, expected_at")
        .eq("ingredient_id", ingredient_id)
        .eq("status", "pending"),
      supabase.from("ingredient_unit_aliases").select("from_unit, factor").eq("ingredient_id", ingredient_id),
    ]);
    const aliases = (aliasRes.data ?? []) as { from_unit: string; factor: number }[];
    const stock = Number(ing.current_stock ?? 0);
    const effStock = effStockRaw ?? stock;
    const window = series.slice(-CONSUMPTION_DAYS);
    let avg = avgPerOpenDay(window, closed);

    // Última contagem que incluiu o insumo.
    let lastCount: string | null = null;
    type CountRow = { inventories: { last_completed_at: string | null; completed_at: string | null } | null };
    for (const c of (counts.data ?? []) as unknown as CountRow[]) {
      const at = c.inventories?.last_completed_at ?? c.inventories?.completed_at;
      if (!at) continue;
      const d = dateSaoPaulo(at);
      if (d <= asOf && (!lastCount || d > lastCount)) lastCount = d;
    }
    const end = new Date(parseDate(asOf).getTime() + horizon * 86400000);
    const orders = ((pending.data ?? []) as { quantity: number; unit: string | null; expected_at: string | null }[]).map(
      (o) => ({
        qty: toIngredientUnit(Number(o.quantity ?? 0), o.unit, ing, aliases).qty,
        expected_at: o.expected_at ? o.expected_at.slice(0, 10) : null,
      }),
    );

    // Sazonalidade opcional: média por dia da semana em vez da média por dia aberto.
    let seasonalForecast: number | null = null;
    if (use_weekday_seasonality) {
      const byDow = seasonalityByDow(window);
      seasonalForecast = 0;
      for (let i = 0; i < horizon; i++) {
        const dow = (parseDate(asOf).getUTCDay() + i) % 7;
        if (!closed.includes(dow)) seasonalForecast += byDow[dow] ?? 0;
      }
      const open = Array.from({ length: horizon }, (_, i) => (parseDate(asOf).getUTCDay() + i) % 7).filter(
        (d) => !closed.includes(d),
      ).length;
      if (open > 0) avg = seasonalForecast / open;
    }

    // Item sozinho: a "próxima entrega" é o fim do horizonte.
    const sch: Schedule = {
      as_of_date: asOf,
      next_order_date: asOf,
      days_to_order: 0,
      lead_days: 0,
      next_delivery_date: asOf,
      possible_interval_days: horizon,
      preferred_interval_days: horizon,
      next_opportunity_delivery_date: isoDate(end),
      days_to_next_opportunity_delivery: horizon,
      safety_days: safety,
      coverage_days: horizon,
      coverage_end_date: isoDate(end),
      closed_weekdays: closed,
    };
    const d = decideItem(
      {
        ingredient_id: ing.id,
        name: ing.name,
        unit: ing.unit,
        purchase_pack_qty: ing.purchase_pack_qty,
        purchase_pack_name: ing.purchase_pack_name,
        avg_daily: avg,
        current_stock: stock,
        effective_stock: effStock,
        last_count_date: lastCount,
        min_stock: Number(ing.min_stock ?? 0),
        unit_cost: Number(ing.avg_cost ?? 0) || Number(ing.last_cost ?? 0),
        orders,
      },
      sch,
    );
    // Quantidade sugerida mesmo quando ainda dá para esperar.
    const need = Math.max(d.coverage_consumption - d.available_stock, d.min_stock - d.available_stock, 0);
    const r = roundToPack(need, ing);
    return ok({
      ingredient: { id: ing.id, name: ing.name, unit: ing.unit },
      as_of_date: asOf,
      closed_weekdays: closed,
      horizon_days: horizon,
      coverage_days: horizon,
      safety_days: safety,
      use_weekday_seasonality: use_weekday_seasonality ?? false,
      avg_daily: d.avg_daily,
      forecast_consumption: d.coverage_consumption,
      current_stock: stock,
      effective_stock: effStock,
      last_count_date: lastCount,
      estimated_stock: d.estimated_stock,
      on_order: d.on_order,
      available_stock: d.available_stock,
      min_stock: d.min_stock,
      days_until_out: d.days_until_out,
      depletion_date: d.depletion_date,
      order_now: d.order,
      decision_reason: d.decision_reason,
      need_qty: need,
      suggested_qty: r.qty,
      packs: r.packs,
      pack_qty: r.pack_qty,
      pack_name: r.pack_name,
      order_text: r.qty > 0 ? orderText(r.qty, r.packs, r.pack_name, ing.unit) : null,
      estimated_cost: Number((r.qty * d.unit_cost).toFixed(2)),
    });
  },
});
