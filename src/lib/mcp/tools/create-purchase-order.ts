import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, getRestaurantId, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "create_purchase_order",
  title: "Registrar compra",
  description:
    "Registra uma ou mais linhas de compra em purchases (entrada de estoque via trigger). Requer aprovação por alterar estoque.",
  inputSchema: {
    supplier: z.string().optional(),
    purchased_at: z.string().datetime().optional().describe("ISO datetime. Padrão: agora."),
    items: z
      .array(
        z.object({
          ingredient_id: z.string().uuid(),
          quantity: z.number().positive(),
          unit_cost: z.number().nonnegative(),
        }),
      )
      .min(1)
      .max(200),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async ({ supplier, purchased_at, items }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();
    if (!userId) return err("Usuário não identificado.");
    const restaurantId = await getRestaurantId(supabase, userId);
    if (!restaurantId) return err("Restaurante não encontrado.");
    const rows = items.map((i) => ({
      restaurant_id: restaurantId,
      ingredient_id: i.ingredient_id,
      quantity: i.quantity,
      unit_cost: i.unit_cost,
      total_cost: Number((i.quantity * i.unit_cost).toFixed(2)),
      supplier: supplier ?? null,
      purchased_at: purchased_at ?? new Date().toISOString(),
    }));
    const { data, error } = await supabase.from("purchases").insert(rows).select();
    if (error) return err(error.message);
    return ok({ inserted: data?.length ?? 0, purchases: data ?? [] }, `Compra registrada: ${data?.length ?? 0} itens.`);
  },
});
