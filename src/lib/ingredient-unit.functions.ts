import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;
type AnyRow = Record<string, any> & { id: string };

// Reads every matching row (PostgREST caps each response at 1000 rows).
async function fetchAllRows(
  client: AnyClient,
  table: string,
  filter: (q: AnyClient) => AnyClient,
): Promise<AnyRow[]> {
  const out: AnyRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await filter(client.from(table).select("*"))
      .order("id")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < pageSize) return out;
  }
}

// Writes full rows back by id. These tables have no BEFORE INSERT triggers, so
// the conflict path fires the same triggers as a plain update.
async function upsertRows(client: AnyClient, table: string, rows: AnyRow[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await client.from(table).upsert(rows.slice(i, i + 500), { onConflict: "id" });
    if (error) throw new Error(error.message);
  }
}

/**
 * Converts an ingredient to a new unit, applying `factor` such that
 * 1 oldUnit = `factor` newUnits. Quantities are multiplied, per-unit
 * costs are divided. Stock movement / purchase row updates trigger the
 * existing stock-apply triggers, so `ingredients.current_stock` is updated
 * automatically — we only update `min_stock`, `avg_cost`, `last_cost`, `unit`.
 */
export const convertIngredientUnit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        ingredientId: z.string().uuid(),
        newUnit: z.string().min(1).max(20),
        factor: z.number().positive(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { ingredientId, newUnit, factor } = data;

    // Authorization: manager/owner only
    const { data: isMgr } = await supabase.rpc("is_manager_or_owner", { _user_id: userId });
    if (!isMgr) throw new Error("Apenas gerentes podem alterar a unidade");

    // Verify the ingredient belongs to the caller's own restaurant using the
    // RLS-scoped client — a cross-tenant id simply comes back as not found here.
    const { data: owned, error: ownedErr } = await supabase
      .from("ingredients")
      .select("id")
      .eq("id", ingredientId)
      .maybeSingle();
    if (ownedErr) throw new Error(ownedErr.message);
    if (!owned) throw new Error("Insumo não encontrado");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ing, error: ingErr } = await supabaseAdmin
      .from("ingredients")
      .select("id, unit, min_stock, avg_cost, last_cost")
      .eq("id", ingredientId)
      .maybeSingle();
    if (ingErr) throw new Error(ingErr.message);
    if (!ing) throw new Error("Insumo não encontrado");
    const oldUnit = ing.unit;
    if (oldUnit === newUnit) return { ok: true, changed: false };

    // Rows are read in full and written back with one bulk upsert per table:
    // one update per row would exceed the Worker subrequest limit for
    // ingredients with a long history.

    // 1) stock_movements: multiply quantity by factor, divide unit_cost
    const mvs = await fetchAllRows(supabaseAdmin, "stock_movements", (q) => q.eq("ingredient_id", ingredientId));
    await upsertRows(
      supabaseAdmin,
      "stock_movements",
      mvs.map((m) => ({
        ...m,
        quantity: Number(m.quantity) * factor,
        unit_cost: m.unit_cost == null ? null : Number(m.unit_cost) / factor,
      })),
    );

    // 2) purchases: multiply quantity, divide unit_cost (total_cost unchanged)
    const pus = await fetchAllRows(supabaseAdmin, "purchases", (q) => q.eq("ingredient_id", ingredientId));
    await upsertRows(
      supabaseAdmin,
      "purchases",
      pus.map((p) => ({
        ...p,
        quantity: Number(p.quantity) * factor,
        unit_cost: Number(p.unit_cost) / factor,
      })),
    );

    // 3) recipe_items where unit matches old unit
    const ris = await fetchAllRows(supabaseAdmin, "recipe_items", (q) =>
      q.eq("ingredient_id", ingredientId).eq("unit", oldUnit),
    );
    await upsertRows(
      supabaseAdmin,
      "recipe_items",
      ris.map((r) => ({ ...r, quantity: Number(r.quantity) * factor, unit: newUnit })),
    );

    // 4) inventory_items
    const invs = await fetchAllRows(supabaseAdmin, "inventory_items", (q) => q.eq("ingredient_id", ingredientId));
    await upsertRows(
      supabaseAdmin,
      "inventory_items",
      invs.map((it) => ({
        ...it,
        unit: newUnit,
        expected_qty: it.expected_qty == null ? it.expected_qty : Number(it.expected_qty) * factor,
        counted_qty: it.counted_qty == null ? it.counted_qty : Number(it.counted_qty) * factor,
      })),
    );

    // 5) ingredient itself: min_stock scaled, costs divided, unit updated.
    // current_stock already updated by triggers from movement/purchase updates.
    await supabaseAdmin
      .from("ingredients")
      .update({
        unit: newUnit,
        min_stock: Number(ing.min_stock ?? 0) * factor,
        avg_cost: factor > 0 ? Number(ing.avg_cost ?? 0) / factor : 0,
        last_cost: factor > 0 ? Number(ing.last_cost ?? 0) / factor : 0,
      })
      .eq("id", ingredientId);

    return { ok: true, changed: true };
  });
