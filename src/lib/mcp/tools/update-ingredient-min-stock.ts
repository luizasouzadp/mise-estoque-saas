import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "update_ingredient_min_stock",
  title: "Atualizar estoque mínimo",
  description:
    "Atualiza o estoque mínimo de um ou mais insumos de uma vez. O valor é na unidade do próprio insumo (confira com list_ingredients antes). O mínimo é usado nos alertas de estoque baixo e na sugestão de compras.",
  inputSchema: {
    items: z
      .array(
        z.object({
          ingredient_id: z.string().uuid(),
          min_stock: z.number().nonnegative(),
        }),
      )
      .min(1)
      .max(300),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async ({ items }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);

    // Uma requisição por valor distinto (não por insumo), para não estourar o
    // limite de requisições do Worker em listas grandes.
    const byValue = new Map<number, string[]>();
    for (const i of items) {
      const ids = byValue.get(i.min_stock) ?? [];
      ids.push(i.ingredient_id);
      byValue.set(i.min_stock, ids);
    }

    const updated: { id: string; name: string; unit: string; min_stock: number }[] = [];
    for (const [value, ids] of byValue) {
      const { data, error } = await supabase
        .from("ingredients")
        .update({ min_stock: value })
        .in("id", ids)
        .select("id, name, unit, min_stock");
      if (error) return err(error.message);
      updated.push(...(data ?? []));
    }

    const found = new Set(updated.map((u) => u.id));
    const not_found = items.map((i) => i.ingredient_id).filter((id) => !found.has(id));
    return ok({ updated_count: updated.length, updated, not_found });
  },
});
