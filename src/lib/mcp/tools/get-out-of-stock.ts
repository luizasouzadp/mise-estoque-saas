import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "get_out_of_stock",
  title: "Itens zerados",
  description: "Lista ingredientes com estoque atual igual ou menor que zero.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("ingredients")
      .select("id, name, unit, current_stock, min_stock")
      .lte("current_stock", 0)
      .order("name");
    if (error) return err(error.message);
    return ok({ count: (data ?? []).length, items: data ?? [] });
  },
});
