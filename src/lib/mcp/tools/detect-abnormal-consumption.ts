import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";
import { dailyConsumption } from "../lib/consumption";
import { mean, stddev } from "../lib/stats";

export default defineTool({
  name: "detect_abnormal_consumption",
  title: "Detectar consumo anormal",
  description:
    "Detecta dias com consumo anormalmente alto (z-score > threshold, padrão 2) para um insumo, sinalizando possíveis desperdícios ou erros de lançamento.",
  inputSchema: {
    ingredient_id: z.string().uuid(),
    history_days: z.number().int().min(14).max(180).optional().describe("Padrão 60."),
    z_threshold: z.number().min(1).max(5).optional().describe("Padrão 2."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ ingredient_id, history_days, z_threshold }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data: ing, error } = await supabase
      .from("ingredients")
      .select("id, name, unit")
      .eq("id", ingredient_id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!ing) return err("Insumo não encontrado.");
    const series = await dailyConsumption(supabase, ingredient_id, history_days ?? 60);
    const qty = series.map((s) => s.qty);
    const m = mean(qty);
    const sd = stddev(qty);
    const thr = z_threshold ?? 2;
    const anomalies = series
      .map((s) => ({
        date: s.date,
        qty: s.qty,
        z: sd > 0 ? Number(((s.qty - m) / sd).toFixed(2)) : 0,
      }))
      .filter((s) => s.z >= thr && s.qty > 0)
      .sort((a, b) => b.z - a.z);
    return ok({
      ingredient: { id: ing.id, name: ing.name, unit: ing.unit },
      mean_daily: Number(m.toFixed(3)),
      stddev_daily: Number(sd.toFixed(3)),
      z_threshold: thr,
      anomalies,
    });
  },
});
