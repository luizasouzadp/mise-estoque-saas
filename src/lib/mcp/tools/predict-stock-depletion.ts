import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";
import { dailyConsumption } from "../lib/consumption";
import { depletionForecast, DEFAULT_LEAD_TIME_DAYS } from "../lib/forecast";

export default defineTool({
  name: "predict_stock_depletion",
  title: "Prever ruptura de estoque",
  description:
    "Estima quando o estoque de um insumo vai acabar, com base no histórico de saídas e produção. Retorna consumo médio diário, dias restantes, data prevista, intervalo de confiança (95%) e nível de risco.",
  inputSchema: {
    ingredient_id: z.string().uuid(),
    history_days: z.number().int().min(14).max(180).optional().describe("Janela histórica (padrão 60)."),
    horizon_days: z.number().int().min(1).max(180).optional().describe("Horizonte máximo em dias (informativo)."),
    lead_time_days: z.number().int().min(0).max(60).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ ingredient_id, history_days, horizon_days, lead_time_days }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data: ing, error } = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, min_stock")
      .eq("id", ingredient_id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!ing) return err("Insumo não encontrado.");
    const series = await dailyConsumption(supabase, ingredient_id, history_days ?? 60);
    const f = depletionForecast(
      Number(ing.current_stock ?? 0),
      series,
      lead_time_days ?? DEFAULT_LEAD_TIME_DAYS,
    );
    return ok(
      {
        ingredient: { id: ing.id, name: ing.name, unit: ing.unit, current_stock: Number(ing.current_stock) },
        history_days: history_days ?? 60,
        horizon_days: horizon_days ?? null,
        lead_time_days: lead_time_days ?? DEFAULT_LEAD_TIME_DAYS,
        forecast: f,
      },
      f.risk === "sem_consumo"
        ? `${ing.name}: sem consumo recente; não é possível prever ruptura.`
        : `${ing.name}: ~${f.days_remaining} dias restantes (ruptura prevista para ${f.depletion_date}, risco ${f.risk}).`,
    );
  },
});
