import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";
import { dailyConsumption } from "../lib/consumption";
import { depletionForecast, DEFAULT_LEAD_TIME_DAYS, DEFAULT_SAFETY_DAYS } from "../lib/forecast";

export default defineTool({
  name: "predict_restock_date",
  title: "Melhor data para nova compra",
  description:
    "Sugere a data ideal para realizar uma nova compra antes da ruptura: data de ruptura menos lead time e estoque de segurança em dias.",
  inputSchema: {
    ingredient_id: z.string().uuid(),
    lead_time_days: z.number().int().min(0).max(60).optional(),
    safety_days: z.number().int().min(0).max(30).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ ingredient_id, lead_time_days, safety_days }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data: ing, error } = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, min_stock")
      .eq("id", ingredient_id)
      .maybeSingle();
    if (error) return err(error.message);
    if (!ing) return err("Insumo não encontrado.");
    const series = await dailyConsumption(supabase, ingredient_id, 60);
    const lead = lead_time_days ?? DEFAULT_LEAD_TIME_DAYS;
    const safety = safety_days ?? DEFAULT_SAFETY_DAYS;
    const f = depletionForecast(Number(ing.current_stock ?? 0), series, lead);
    let restockDate: string | null = null;
    let daysUntilOrder: number | null = null;
    if (f.days_remaining != null) {
      const offset = Math.max(0, Math.floor(f.days_remaining - lead - safety));
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + offset);
      restockDate = d.toISOString().slice(0, 10);
      daysUntilOrder = offset;
    }
    return ok({
      ingredient: { id: ing.id, name: ing.name, unit: ing.unit },
      current_stock: Number(ing.current_stock),
      lead_time_days: lead,
      safety_days: safety,
      forecast: f,
      recommended_order_date: restockDate,
      days_until_order: daysUntilOrder,
    });
  },
});
