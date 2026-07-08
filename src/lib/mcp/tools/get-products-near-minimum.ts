import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "get_products_near_minimum",
  title: "Itens próximos do mínimo",
  description:
    "Lista ingredientes cujo estoque está dentro de uma tolerância (padrão 20%) acima do estoque mínimo.",
  inputSchema: {
    tolerance_percent: z
      .number()
      .min(0)
      .max(200)
      .optional()
      .describe("% acima do mínimo considerado 'próximo' (padrão 20)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ tolerance_percent }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const tol = (tolerance_percent ?? 20) / 100;
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, min_stock");
    if (error) return err(error.message);
    const items = (data ?? [])
      .filter((r) => {
        const min = Number(r.min_stock ?? 0);
        const cur = Number(r.current_stock ?? 0);
        if (min <= 0) return false;
        return cur >= min && cur <= min * (1 + tol);
      })
      .sort(
        (a, b) =>
          Number(a.current_stock ?? 0) / Number(a.min_stock ?? 1) -
          Number(b.current_stock ?? 0) / Number(b.min_stock ?? 1),
      );
    return ok({ count: items.length, tolerance_percent: (tol * 100), items });
  },
});
