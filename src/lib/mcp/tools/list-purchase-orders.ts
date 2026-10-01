import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import { supabaseForUser, notAuthed, err, ok } from "../lib/supabase-for-user";

type Row = {
  id: string;
  supplier_id: string | null;
  supplier_name: string | null;
  ingredient_id: string;
  quantity: number;
  unit: string;
  expected_at: string | null;
  status: string;
  notes: string | null;
  created_at: string;
  received_at: string | null;
  ingredient: { name: string } | null;
};

// YYYY-MM-DD no fuso do restaurante (Brasil), para comparar com expected_at.
function todaySaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

export default defineTool({
  name: "list_purchase_orders",
  title: "Listar encomendas",
  description:
    "Lista as encomendas (pedidos feitos a fornecedores) da página Encomendas, agrupadas por fornecedor, com insumo, quantidade, unidade, data prevista de entrega e observações. Por padrão mostra só as pendentes (já pedidas e ainda não recebidas) e marca as atrasadas (data prevista antes de hoje). Use antes de sugerir compras para não pedir de novo o que já está a caminho.",
  inputSchema: {
    status: z
      .enum(["pending", "received", "cancelled", "all"])
      .optional()
      .describe(
        "pending (padrão) = aguardando entrega; received = recebidas; cancelled = canceladas; all = todas.",
      ),
    supplier: z
      .string()
      .optional()
      .describe("Filtra pelo nome do fornecedor (parte do nome, sem diferenciar maiúsculas)."),
    ingredient_id: z.string().uuid().optional().describe("Filtra por um insumo específico."),
    days: z
      .number()
      .int()
      .min(1)
      .max(365)
      .optional()
      .describe(
        "Para received/cancelled/all: só encomendas criadas nos últimos N dias (padrão 30). Ignorado para pending.",
      ),
    limit: z.number().int().min(1).max(500).optional().describe("Máximo de linhas (padrão 300)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ status, supplier, ingredient_id, days, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return notAuthed();
    const supabase = supabaseForUser(ctx);
    const st = status ?? "pending";

    let q = supabase
      .from("purchase_orders")
      .select(
        "id, supplier_id, supplier_name, ingredient_id, quantity, unit, expected_at, status, notes, created_at, received_at, ingredient:ingredients(name)",
      )
      .order("expected_at", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit ?? 300);
    if (st !== "all") q = q.eq("status", st);
    if (st !== "pending") {
      const since = new Date();
      since.setUTCDate(since.getUTCDate() - (days ?? 30));
      q = q.gte("created_at", since.toISOString());
    }
    if (supplier) q = q.ilike("supplier_name", `%${supplier}%`);
    if (ingredient_id) q = q.eq("ingredient_id", ingredient_id);

    const { data, error } = await q;
    if (error) return err(error.message);

    const today = todaySaoPaulo();
    const groups = new Map<
      string,
      { supplier_id: string | null; supplier: string; orders: Record<string, unknown>[] }
    >();
    let overdue = 0;
    for (const r of (data ?? []) as unknown as Row[]) {
      const name = r.supplier_name ?? "Sem fornecedor";
      const g = groups.get(name) ?? { supplier_id: r.supplier_id, supplier: name, orders: [] };
      const expected = r.expected_at ? r.expected_at.slice(0, 10) : null;
      const isOverdue = r.status === "pending" && !!expected && expected < today;
      if (isOverdue) overdue++;
      g.orders.push({
        id: r.id,
        ingredient_id: r.ingredient_id,
        ingredient: r.ingredient?.name ?? null,
        quantity: Number(r.quantity),
        unit: r.unit,
        expected_at: expected,
        overdue: isOverdue,
        status: r.status,
        notes: r.notes,
        ordered_at: r.created_at,
        received_at: r.received_at,
      });
      groups.set(name, g);
    }

    const suppliers = Array.from(groups.values()).sort((a, b) =>
      a.supplier.localeCompare(b.supplier, "pt-BR"),
    );
    return ok({
      status: st,
      today,
      total_orders: data?.length ?? 0,
      overdue_orders: overdue,
      suppliers,
    });
  },
});
