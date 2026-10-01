import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";
import { dailyConsumption, effectiveStock } from "../lib/consumption";
import { suggestPurchaseQty, DEFAULT_SAFETY_DAYS } from "../lib/forecast";

export default defineTool({
  name: "suggest_purchase_quantity",
  title: "Sugerir quantidade de compra",
  description:
    "Sugere quanto comprar de um insumo para cobrir um horizonte (padrão 15 dias) considerando consumo histórico (previsão = consumo médio diário × horizon_days; sazonalidade por dia da semana opcional), estoque efetivo, mínimo e estoque de segurança.",
  inputSchema: {
    ingredient_id: z.string().uuid(),
    horizon_days: z.number().int().min(1).max(60).optional().describe("Padrão 15."),
    safety_days: z.number().int().min(0).max(30).optional(),
    use_weekday_seasonality: z
      .boolean()
      .optional()
      .describe(
        "Padrão false: previsão = consumo médio diário × dias de cobertura. Ligue só quando o consumo for lançado diariamente (ex.: vendas do Saipos).",
      ),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ ingredient_id, horizon_days, safety_days, use_weekday_seasonality }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data: ing, error } = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, min_stock, avg_cost, last_cost")
      .eq("id", ingredient_id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!ing) return err("Insumo não encontrado.");
    // Estoque efetivo: inclui o insumo que já está dentro dos pré-preparos em estoque.
    const effStock = (await effectiveStock(supabase, ingredient_id)) ?? Number(ing.current_stock ?? 0);
    const horizon = horizon_days ?? 15;
    const series = await dailyConsumption(supabase, ingredient_id, 60);
    const s = suggestPurchaseQty(
      effStock,
      Number(ing.min_stock ?? 0),
      series,
      horizon,
      safety_days ?? DEFAULT_SAFETY_DAYS,
      use_weekday_seasonality ?? false,
    );
    const cost = Number(ing.avg_cost ?? 0) || Number(ing.last_cost ?? 0);
    return ok({
      ingredient: { id: ing.id, name: ing.name, unit: ing.unit },
      current_stock: Number(ing.current_stock),
      effective_stock: effStock,
      min_stock: Number(ing.min_stock),
      horizon_days: horizon,
      coverage_days: horizon,
      use_weekday_seasonality: use_weekday_seasonality ?? false,
      safety_days: safety_days ?? DEFAULT_SAFETY_DAYS,
      ...s,
      estimated_cost: Number((s.suggested_qty * cost).toFixed(2)),
    });
  },
});
