import { defineTool } from "@lovable.dev/mcp-js";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "list_suppliers",
  title: "Listar fornecedores",
  description:
    "Lista os fornecedores do restaurante com agenda semanal (dias de pedido, dias de entrega, prazo em dias, valor mínimo de pedido e observações). Convenção de dias: 0=domingo … 6=sábado.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name, delivery_days, order_days, lead_time_days, min_order_value, notes")
      .order("name");
    if (error) return err(error.message);
    return ok({ suppliers: data ?? [] });
  },
});
