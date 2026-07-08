import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, ok } from "../lib/supabase-for-user";
import { dailyConsumption, totalOut } from "../lib/consumption";

export default defineTool({
  name: "get_consumption_trends",
  title: "Tendência de consumo",
  description:
    "Compara o consumo dos últimos N dias vs. o período anterior de mesmo tamanho e retorna a variação percentual.",
  inputSchema: {
    ingredient_id: z.string().uuid(),
    window_days: z.number().int().min(7).max(180).optional().describe("Padrão 30."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ ingredient_id, window_days }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const w = window_days ?? 30;
    const series = await dailyConsumption(supabase, ingredient_id, w * 2);
    const half = Math.floor(series.length / 2);
    const previous = totalOut(series.slice(0, half));
    const current = totalOut(series.slice(half));
    const pct =
      previous > 0
        ? ((current - previous) / previous) * 100
        : current > 0
          ? 100
          : 0;
    let trend: "aumento" | "queda" | "estavel" = "estavel";
    if (pct > 10) trend = "aumento";
    else if (pct < -10) trend = "queda";
    return ok({
      window_days: w,
      previous_period_total: Number(previous.toFixed(3)),
      current_period_total: Number(current.toFixed(3)),
      change_percent: Number(pct.toFixed(1)),
      trend,
      series,
    });
  },
});
