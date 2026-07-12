import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "get_product_stock",
  title: "Consultar saldo de um insumo",
  description:
    "Retorna o saldo atual, estoque mínimo, unidade, custo e fornecedor padrão de um ingrediente. Aceita id ou nome (busca parcial).",
  inputSchema: {
    ingredient_id: z.string().uuid().optional(),
    name: z.string().trim().min(1).optional(),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ ingredient_id, name }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    if (!ingredient_id && !name) return err("Informe ingredient_id ou name.");
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("ingredients")
      .select(
        "id, name, unit, category, current_stock, min_stock, avg_cost, last_cost, default_supplier_id, default_supplier:suppliers!ingredients_default_supplier_id_fkey(id, name)",
      );
    if (ingredient_id) q = q.eq("id", ingredient_id);
    else if (name) q = q.ilike("name", `%${name}%`);
    const { data, error } = await q.limit(5);
    if (error) return err(error.message);
    const rows = data ?? [];
    if (rows.length === 0) return err("Insumo não encontrado.");
    return ok({ matches: rows });
  },
});
