import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

export default defineTool({
  name: "get_supplier_products",
  title: "Produtos comprados de um fornecedor",
  description:
    "Retorna os insumos comprados de um fornecedor específico (por nome), com quantidade total, custo médio e última compra.",
  inputSchema: {
    supplier: z.string().min(1).describe("Nome do fornecedor (como registrado em purchases.supplier)."),
    days: z.number().int().min(7).max(365).optional().describe("Janela em dias (padrão 180)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ supplier, days }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - (days ?? 180));
    const { data, error } = await supabase
      .from("purchases")
      .select("ingredient_id, quantity, unit_cost, total_cost, purchased_at, ingredients!inner(name, unit)")
      .eq("supplier", supplier)
      .gte("purchased_at", since.toISOString())
      .order("purchased_at", { ascending: false });
    if (error) return err(error.message);
    type Row = {
      ingredient_id: string;
      quantity: number;
      unit_cost: number;
      total_cost: number;
      purchased_at: string;
      ingredients: { name: string; unit: string };
    };
    const agg = new Map<string, { name: string; unit: string; total_qty: number; total_cost: number; last_at: string }>();
    for (const r of (data ?? []) as unknown as Row[]) {
      const e =
        agg.get(r.ingredient_id) ??
        { name: r.ingredients.name, unit: r.ingredients.unit, total_qty: 0, total_cost: 0, last_at: r.purchased_at };
      e.total_qty += Number(r.quantity ?? 0);
      e.total_cost += Number(r.total_cost ?? 0);
      if (r.purchased_at > e.last_at) e.last_at = r.purchased_at;
      agg.set(r.ingredient_id, e);
    }
    const items = Array.from(agg.entries()).map(([id, v]) => ({
      ingredient_id: id,
      name: v.name,
      unit: v.unit,
      total_quantity: Number(v.total_qty.toFixed(3)),
      total_spent: Number(v.total_cost.toFixed(2)),
      avg_unit_cost: v.total_qty > 0 ? Number((v.total_cost / v.total_qty).toFixed(4)) : 0,
      last_purchased_at: v.last_at,
    }));
    return ok({ supplier, window_days: days ?? 180, items });
  },
});
