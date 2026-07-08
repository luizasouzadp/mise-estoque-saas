import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, ok } from "../lib/supabase-for-user";
import { dailyConsumption } from "../lib/consumption";
import { mean, seasonalityByDow } from "../lib/stats";

export default defineTool({
  name: "forecast_product_consumption",
  title: "Prever consumo futuro",
  description:
    "Projeta o consumo futuro (por dia, semana e mês) de um ingrediente com base em média histórica e sazonalidade por dia da semana.",
  inputSchema: {
    ingredient_id: z.string().uuid(),
    horizon_days: z.number().int().min(1).max(180).optional().describe("Padrão 30."),
    history_days: z.number().int().min(14).max(180).optional().describe("Padrão 60."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ ingredient_id, horizon_days, history_days }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const h = horizon_days ?? 30;
    const series = await dailyConsumption(supabase, ingredient_id, history_days ?? 60);
    const avg = mean(series.map((s) => s.qty));
    const seasonal = seasonalityByDow(series);
    const start = new Date();
    const daily: { date: string; expected_qty: number }[] = [];
    for (let i = 0; i < h; i++) {
      const d = new Date(start);
      d.setUTCDate(start.getUTCDate() + i);
      const dow = d.getUTCDay();
      const v = seasonal[dow] > 0 ? seasonal[dow] : avg;
      daily.push({ date: d.toISOString().slice(0, 10), expected_qty: Number(v.toFixed(3)) });
    }
    const totalHorizon = daily.reduce((a, d) => a + d.expected_qty, 0);
    return ok({
      horizon_days: h,
      avg_per_day: Number(avg.toFixed(3)),
      forecast_total: Number(totalHorizon.toFixed(3)),
      forecast_week: Number((avg * 7).toFixed(3)),
      forecast_month: Number((avg * 30).toFixed(3)),
      daily,
    });
  },
});
