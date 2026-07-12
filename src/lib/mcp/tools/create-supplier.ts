import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

const DayOfWeek = z
  .number()
  .int()
  .min(0)
  .max(6)
  .describe("0=domingo, 1=segunda, ... 6=sábado.");

export default defineTool({
  name: "create_supplier",
  title: "Cadastrar fornecedor",
  description:
    "Cria um fornecedor com agenda semanal opcional (dias de pedido e de entrega, prazo, valor mínimo e observações). Convenção de dias: 0=domingo … 6=sábado.",
  inputSchema: {
    name: z.string().trim().min(1),
    delivery_days: z.array(DayOfWeek).optional(),
    order_days: z.array(DayOfWeek).optional(),
    lead_time_days: z.number().int().min(0).optional(),
    min_order_value: z.number().nonnegative().optional(),
    notes: z.string().trim().optional(),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const { data: prof } = await supabase
      .from("profiles")
      .select("restaurant_id")
      .eq("id", ctx.getUserId())
      .maybeSingle();
    if (!prof?.restaurant_id) return err("Restaurante não encontrado.");
    const { data, error } = await supabase
      .from("suppliers")
      .insert({
        restaurant_id: prof.restaurant_id,
        name: input.name,
        delivery_days: input.delivery_days ?? [],
        order_days: input.order_days ?? [],
        lead_time_days: input.lead_time_days ?? null,
        min_order_value: input.min_order_value ?? null,
        notes: input.notes ?? null,
      })
      .select("*")
      .single();
    if (error) return err(error.message);
    return ok({ supplier: data }, `Fornecedor "${data.name}" cadastrado.`);
  },
});
