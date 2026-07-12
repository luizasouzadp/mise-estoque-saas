import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

const DayOfWeek = z.number().int().min(0).max(6);

export default defineTool({
  name: "update_supplier",
  title: "Editar fornecedor",
  description:
    "Atualiza campos de um fornecedor existente. Apenas os campos enviados são alterados. Convenção de dias: 0=domingo … 6=sábado.",
  inputSchema: {
    supplier_id: z.string().uuid(),
    name: z.string().trim().min(1).optional(),
    delivery_days: z.array(DayOfWeek).optional(),
    order_days: z.array(DayOfWeek).optional(),
    lead_time_days: z.number().int().min(0).nullable().optional(),
    min_order_value: z.number().nonnegative().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
  handler: async ({ supplier_id, ...patch }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) update[k] = v;
    }
    if (Object.keys(update).length === 0) return err("Nenhum campo para atualizar.");
    const { data, error } = await supabase
      .from("suppliers")
      .update(update)
      .eq("id", supplier_id)
      .select("*")
      .single();
    if (error) return err(error.message);
    return ok({ supplier: data }, `Fornecedor "${data.name}" atualizado.`);
  },
});
