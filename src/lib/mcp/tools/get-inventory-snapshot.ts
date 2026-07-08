import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "get_inventory_snapshot",
  title: "Snapshot do estoque em uma data",
  description:
    "Reconstrói o estoque de cada insumo em uma data específica, revertendo movimentações posteriores ao ponto de corte.",
  inputSchema: {
    at_date: z.string().datetime().describe("ISO datetime do ponto de corte."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ at_date }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const [{ data: ings, error: e1 }, { data: mv, error: e2 }] = await Promise.all([
      supabase.from("ingredients").select("id, name, unit, current_stock"),
      supabase
        .from("stock_movements")
        .select("ingredient_id, type, quantity")
        .gt("occurred_at", at_date),
    ]);
    if (e1) return err(e1.message);
    if (e2) return err(e2.message);
    const delta = new Map<string, number>();
    for (const m of mv ?? []) {
      const d = m.type === "in" ? Number(m.quantity) : -Number(m.quantity);
      delta.set(m.ingredient_id, (delta.get(m.ingredient_id) ?? 0) + d);
    }
    const snapshot = (ings ?? []).map((i) => ({
      id: i.id,
      name: i.name,
      unit: i.unit,
      stock_at: Number((Number(i.current_stock ?? 0) - (delta.get(i.id) ?? 0)).toFixed(3)),
    }));
    return ok({ at_date, snapshot });
  },
});
