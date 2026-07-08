import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "get_inventory_value",
  title: "Valor financeiro do estoque",
  description:
    "Calcula o valor financeiro total do estoque (estoque × custo médio). Opcionalmente agrupa por categoria.",
  inputSchema: {
    group_by_category: z.boolean().optional().describe("Se true, quebra o valor por categoria."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ group_by_category }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("ingredients")
      .select("name, category, current_stock, avg_cost, last_cost");
    if (error) return err(error.message);
    const rows = data ?? [];
    let total = 0;
    const byCat = new Map<string, number>();
    for (const r of rows) {
      const cost = Number(r.avg_cost ?? 0) || Number(r.last_cost ?? 0);
      const v = Number(r.current_stock ?? 0) * cost;
      total += v;
      if (group_by_category) {
        const key = r.category ?? "Sem categoria";
        byCat.set(key, (byCat.get(key) ?? 0) + v);
      }
    }
    const out: Record<string, unknown> = { total_value: Number(total.toFixed(2)) };
    if (group_by_category) {
      out.by_category = Array.from(byCat.entries())
        .map(([category, value]) => ({ category, value: Number(value.toFixed(2)) }))
        .sort((a, b) => b.value - a.value);
    }
    return ok(out, `Valor total em estoque: R$ ${Number(total).toFixed(2)}.`);
  },
});
