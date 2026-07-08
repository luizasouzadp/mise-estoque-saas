import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "detect_dead_stock",
  title: "Detectar estoque parado",
  description:
    "Lista ingredientes com estoque positivo e sem qualquer movimentação nos últimos N dias (padrão 60).",
  inputSchema: {
    days: z.number().int().min(7).max(365).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ days }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const d = days ?? 60;
    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - d);
    const [{ data: ings, error: e1 }, { data: mv, error: e2 }] = await Promise.all([
      supabase
        .from("ingredients")
        .select("id, name, unit, current_stock, avg_cost, last_cost")
        .gt("current_stock", 0),
      supabase
        .from("stock_movements")
        .select("ingredient_id")
        .gte("occurred_at", cutoff.toISOString()),
    ]);
    if (e1) return err(e1.message);
    if (e2) return err(e2.message);
    const active = new Set((mv ?? []).map((m) => m.ingredient_id));
    const items = (ings ?? [])
      .filter((i) => !active.has(i.id))
      .map((i) => {
        const cost = Number(i.avg_cost ?? 0) || Number(i.last_cost ?? 0);
        return {
          id: i.id,
          name: i.name,
          unit: i.unit,
          current_stock: Number(i.current_stock),
          value_stopped: Number((Number(i.current_stock) * cost).toFixed(2)),
        };
      })
      .sort((a, b) => b.value_stopped - a.value_stopped);
    const totalStopped = items.reduce((a, b) => a + b.value_stopped, 0);
    return ok({
      window_days: d,
      count: items.length,
      total_value_stopped: Number(totalStopped.toFixed(2)),
      items,
    });
  },
});
