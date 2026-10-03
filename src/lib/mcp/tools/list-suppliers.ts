import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "list_suppliers",
  title: "Listar fornecedores",
  description:
    "Lista os fornecedores ativos do restaurante com agenda (dias de pedido e de entrega; convenção 0=domingo … 6=sábado), prazo sem dia fixo (lead_time_days), pedido mínimo, frequência (order_frequency: weekly/biweekly/monthly/on_demand), intervalo possível (possible_interval_days; vazio = deduzido dos dias de pedido), intervalo preferido (preferred_interval_days, vem da frequência: 7/14/30), cobertura mínima (min_coverage_days), margem de segurança (safety_days) e contato.",
  inputSchema: {
    include_inactive: z
      .boolean()
      .optional()
      .describe("Padrão false. Se true, inclui também os fornecedores desativados."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ include_inactive }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    let q = supabase
      .from("suppliers")
      .select(
        "id, name, contact_name, phone, delivery_days, order_days, lead_time_days, min_order_value, order_frequency, order_interval_days, possible_interval_days, min_coverage_days, safety_days, is_active, notes",
      )
      .order("name");
    if (!include_inactive) q = q.eq("is_active", true);
    const { data, error } = await q;
    if (error) return err(error.message);
    const suppliers = (data ?? []).map(({ order_interval_days, ...s }) => ({
      ...s,
      preferred_interval_days: order_interval_days,
    }));
    return ok({ suppliers });
  },
});
