import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "update_ingredient_supplier",
  title: "Definir fornecedor padrão de um insumo",
  description:
    "Define (ou remove, quando supplier_id é null) o fornecedor principal de um insumo. Esse fornecedor é usado como agrupador da lista de compras semanal e para calcular o horizonte de cobertura da sugestão. Outros fornecedores já vinculados ao insumo são mantidos como secundários.",
  inputSchema: {
    ingredient_id: z.string().uuid(),
    supplier_id: z
      .string()
      .uuid()
      .nullable()
      .describe("Envie null para limpar o fornecedor padrão."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ ingredient_id, supplier_id }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data: ing, error: ingErr } = await supabase
      .from("ingredients")
      .select("id, restaurant_id")
      .eq("id", ingredient_id)
      .single();
    if (ingErr) return err(ingErr.message);

    // The app reads the supplier from ingredient_suppliers (is_primary); a DB
    // trigger copies the primary into ingredients.default_supplier_id. Clear the
    // current primary first — a unique index allows only one per ingredient.
    const { error: clearErr } = await supabase
      .from("ingredient_suppliers")
      .update({ is_primary: false })
      .eq("ingredient_id", ingredient_id)
      .eq("is_primary", true);
    if (clearErr) return err(clearErr.message);

    if (supplier_id) {
      const { error: linkErr } = await supabase
        .from("ingredient_suppliers")
        .upsert(
          { ingredient_id, supplier_id, restaurant_id: ing.restaurant_id, is_primary: true },
          { onConflict: "ingredient_id,supplier_id" },
        );
      if (linkErr) return err(linkErr.message);
    }

    // Also write the column directly: the trigger only fires when a primary is
    // set, and this keeps the result correct even if it didn't.
    const { data, error } = await supabase
      .from("ingredients")
      .update({ default_supplier_id: supplier_id })
      .eq("id", ingredient_id)
      .select("id, name, default_supplier_id")
      .single();
    if (error) return err(error.message);
    return ok(
      { ingredient: data },
      `Fornecedor padrão ${supplier_id ? "atualizado" : "removido"}.`,
    );
  },
});
