import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "update_ingredient_supplier",
  title: "Definir fornecedor padrão de um insumo",
  description:
    "Define (ou remove, quando supplier_id é null) o fornecedor padrão de um insumo. Esse fornecedor é usado como agrupador da lista de compras semanal e para calcular o horizonte de cobertura da sugestão.",
  inputSchema: {
    ingredient_id: z.string().uuid(),
    supplier_id: z.string().uuid().nullable().describe("Envie null para limpar o fornecedor padrão."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ ingredient_id, supplier_id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("ingredients")
      .update({ default_supplier_id: supplier_id })
      .eq("id", ingredient_id)
      .select("id, name, default_supplier_id")
      .single();
    if (error) return err(error.message);
    return ok({ ingredient: data }, `Fornecedor padrão ${supplier_id ? "atualizado" : "removido"}.`);
  },
});
