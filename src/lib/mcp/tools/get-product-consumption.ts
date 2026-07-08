import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";
import { dailyConsumption, totalOut } from "../lib/consumption";

export default defineTool({
  name: "get_product_consumption",
  title: "Consumo de um insumo",
  description:
    "Calcula o consumo (saídas + produção) de um ingrediente nos últimos N dias e retorna totais diário, semanal e mensal médios.",
  inputSchema: {
    ingredient_id: z.string().uuid(),
    days: z.number().int().min(7).max(365).optional().describe("Janela em dias (padrão 30)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ ingredient_id, days }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const d = days ?? 30;
    const series = await dailyConsumption(supabase, ingredient_id, d);
    const total = totalOut(series);
    const avg = total / Math.max(series.length, 1);
    return ok({
      window_days: d,
      total_consumed: Number(total.toFixed(3)),
      avg_per_day: Number(avg.toFixed(3)),
      avg_per_week: Number((avg * 7).toFixed(3)),
      avg_per_month: Number((avg * 30).toFixed(3)),
      daily: series,
    });
  },
});
