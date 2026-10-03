import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

const DayOfWeek = z.number().int().min(0).max(6);

export default defineTool({
  name: "update_supplier",
  title: "Editar fornecedor",
  description:
    "Atualiza campos de um fornecedor existente. Apenas os campos enviados são alterados. Convenção de dias: 0=domingo … 6=sábado. O intervalo preferido vem da frequência (weekly=7, biweekly=14, monthly=30, on_demand=sem intervalo fixo); o intervalo possível é quando dá para pedir de novo (ex.: Daniel entrega toda semana = 7, mas prefere quinzenal). lead_time_days só é usado quando o fornecedor não tem dias de entrega fixos.",
  inputSchema: {
    supplier_id: z.string().uuid(),
    name: z.string().trim().min(1).optional(),
    delivery_days: z.array(DayOfWeek).optional(),
    order_days: z.array(DayOfWeek).optional(),
    lead_time_days: z.number().int().min(0).nullable().optional(),
    min_order_value: z.number().nonnegative().nullable().optional(),
    notes: z.string().trim().nullable().optional(),
    order_frequency: z
      .enum(["weekly", "biweekly", "monthly", "on_demand"])
      .nullable()
      .optional()
      .describe("Frequência preferida de pedido; define o intervalo preferido (7/14/30)."),
    possible_interval_days: z
      .number()
      .int()
      .min(1)
      .max(120)
      .nullable()
      .optional()
      .describe("Intervalo possível entre pedidos, em dias. null = deduzir dos dias de pedido."),
    min_coverage_days: z
      .number()
      .int()
      .min(0)
      .max(180)
      .nullable()
      .optional()
      .describe("Cobertura mínima em dias (ex.: Camaquã 15)."),
    safety_days: z.number().int().min(0).max(30).optional().describe("Margem de segurança em dias (padrão 2)."),
    is_active: z.boolean().optional().describe("false = desativar sem perder o histórico."),
    contact_name: z.string().trim().nullable().optional(),
    phone: z.string().trim().nullable().optional(),
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
    const { order_interval_days, ...rest } = data as Record<string, unknown>;
    return ok(
      { supplier: { ...rest, preferred_interval_days: order_interval_days } },
      `Fornecedor "${data.name}" atualizado.`,
    );
  },
});
