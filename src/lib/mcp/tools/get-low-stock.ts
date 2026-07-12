import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "get_low_stock",
  title: "Itens abaixo do mínimo",
  description: "Lista todos os ingredientes com estoque atual abaixo do estoque mínimo.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, min_stock, avg_cost");
    if (error) return err(error.message);
    const items = (data ?? [])
      .filter((r) => Number(r.current_stock ?? 0) < Number(r.min_stock ?? 0))
      .map((r) => ({
        ...r,
        deficit: Number(
          (Number(r.min_stock ?? 0) - Number(r.current_stock ?? 0)).toFixed(3),
        ),
      }))
      .sort((a, b) => b.deficit - a.deficit);
    return ok(
      { count: items.length, items },
      JSON.stringify({ count: items.length, items }, null, 2),
    );
  },
});
