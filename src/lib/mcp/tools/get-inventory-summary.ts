import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "get_inventory_summary",
  title: "Resumo do estoque",
  description:
    "Retorna indicadores gerais do estoque: número de itens, valor total, itens abaixo do mínimo, zerados e sem movimentação recente.",
  inputSchema: {
    dead_stock_days: z
      .number()
      .int()
      .min(7)
      .max(365)
      .optional()
      .describe("Dias sem movimentação para considerar item sem giro (padrão 60)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ dead_stock_days }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const deadDays = dead_stock_days ?? 60;

    const { data: ings, error } = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, min_stock, avg_cost, last_cost");
    if (error) return err(error.message);
    const list = ings ?? [];

    const cutoff = new Date();
    cutoff.setUTCDate(cutoff.getUTCDate() - deadDays);
    const { data: recentMv } = await supabase
      .from("stock_movements")
      .select("ingredient_id")
      .gte("occurred_at", cutoff.toISOString());
    const active = new Set((recentMv ?? []).map((m) => m.ingredient_id));

    let totalValue = 0;
    let below = 0;
    let zeroed = 0;
    let dead = 0;
    for (const i of list) {
      const stock = Number(i.current_stock ?? 0);
      const cost = Number(i.avg_cost ?? 0) || Number(i.last_cost ?? 0);
      totalValue += stock * cost;
      if (stock <= 0) zeroed++;
      else if (stock < Number(i.min_stock ?? 0)) below++;
      if (!active.has(i.id) && stock > 0) dead++;
    }

    const out = {
      total_items: list.length,
      total_inventory_value: Number(totalValue.toFixed(2)),
      below_minimum: below,
      out_of_stock: zeroed,
      dead_stock_items: dead,
      dead_stock_window_days: deadDays,
    };
    return ok(
      out,
      `Estoque: ${out.total_items} itens · valor R$ ${out.total_inventory_value.toFixed(2)} · ${out.below_minimum} abaixo do mínimo · ${out.out_of_stock} zerados · ${out.dead_stock_items} sem giro há ${deadDays}d.`,
    );
  },
});
