import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "list_suppliers",
  title: "Listar fornecedores",
  description: "Lista os fornecedores cadastrados no restaurante.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase.from("suppliers").select("id, name").order("name");
    if (error) return err(error.message);
    return ok({ suppliers: data ?? [] });
  },
});
