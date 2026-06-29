import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Public: load an inventory by its public token (single link per inventory).
export const getInventoryByToken = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: inv, error } = await supabaseAdmin
      .from("inventories")
      .select("id, name, status, restaurant_id, frequency, last_completed_at")
      .eq("public_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Inventário não encontrado");

    const [{ data: rest }, { data: items }, { data: groupRows }] = await Promise.all([
      supabaseAdmin.from("restaurants").select("name").eq("id", inv.restaurant_id).maybeSingle(),
      supabaseAdmin
        .from("inventory_items")
        .select("id, ingredient_id, ingredient_name, unit, expected_qty, counted_qty, group_id")
        .eq("inventory_id", inv.id)
        .order("ingredient_name"),
      supabaseAdmin.from("ingredient_groups").select("id, name"),
    ]);
    const gmap = new Map((groupRows ?? []).map((g) => [g.id, g.name]));

    // Use current stock (live) instead of the snapshot saved at inventory creation,
    // so the "Sistema" value matches reality at the moment of counting.
    const ingIds = Array.from(new Set((items ?? []).map((i) => i.ingredient_id).filter(Boolean)));
    const stockMap = new Map<string, number>();
    if (ingIds.length > 0) {
      const { data: stocks } = await supabaseAdmin
        .from("ingredients")
        .select("id, current_stock")
        .in("id", ingIds);
      for (const s of stocks ?? []) stockMap.set(s.id, Number(s.current_stock ?? 0));
    }

    return {
      inventoryId: inv.id,
      inventoryName: inv.name ?? "Inventário",
      inventoryStatus: inv.status,
      restaurantName: rest?.name ?? "Restaurante",
      items: (items ?? []).map((i) => ({
        ...i,
        expected_qty: stockMap.get(i.ingredient_id) ?? Number(i.expected_qty ?? 0),
        groupName: i.group_id ? (gmap.get(i.group_id) ?? "Sem grupo") : "Sem grupo",
      })),
    };
  });

// Public: counters submit their counts. Does NOT finalize; admin closes the cycle.
export const submitInventoryCount = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().uuid(),
        counts: z
          .array(z.object({ itemId: z.string().uuid(), countedQty: z.number().min(0) }))
          .min(1)
          .max(2000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: inv, error } = await supabaseAdmin
      .from("inventories")
      .select("id, status")
      .eq("public_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status === "cancelled") throw new Error("Inventário cancelado");

    const { data: items } = await supabaseAdmin
      .from("inventory_items")
      .select("id")
      .eq("inventory_id", inv.id);
    const validIds = new Set((items ?? []).map((i) => i.id));

    for (const c of data.counts) {
      if (!validIds.has(c.itemId)) continue;
      const { error: upErr } = await supabaseAdmin
        .from("inventory_items")
        .update({ counted_qty: c.countedQty })
        .eq("id", c.itemId);
      if (upErr) throw new Error(upErr.message);
    }
    return { ok: true };
  });

// Admin finalizes the cycle: sums counted_qty per ingredient, updates stock,
// resets items so the recurring inventory can be counted again next cycle.
export const finalizeInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ inventoryId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: inv, error: invErr } = await supabase
      .from("inventories")
      .select("id, name, restaurant_id, status")
      .eq("id", data.inventoryId)
      .maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!inv) throw new Error("Inventário não encontrado");

    const { data: items, error: iErr } = await supabaseAdmin
      .from("inventory_items")
      .select("id, ingredient_id, counted_qty")
      .eq("inventory_id", data.inventoryId);
    if (iErr) throw new Error(iErr.message);

    const totals = new Map<string, number>();
    let counted = false;
    for (const it of items ?? []) {
      if (it.counted_qty == null) continue;
      counted = true;
      totals.set(it.ingredient_id, (totals.get(it.ingredient_id) ?? 0) + Number(it.counted_qty));
    }
    if (!counted) throw new Error("Nenhuma contagem registrada ainda");

    // Read current stocks to compute deltas and register stock movements
    const ingredientIds = Array.from(totals.keys());
    const { data: ings, error: ingErr } = await supabaseAdmin
      .from("ingredients")
      .select("id, current_stock")
      .in("id", ingredientIds)
      .eq("restaurant_id", inv.restaurant_id);
    if (ingErr) throw new Error(ingErr.message);

    const stockMap = new Map((ings ?? []).map((i) => [i.id, Number(i.current_stock ?? 0)]));
    const now = new Date().toISOString();
    const reasonBase = `Inventário${inv.name ? ` · ${inv.name}` : ""}`;

    const movements: Array<{
      restaurant_id: string;
      ingredient_id: string;
      type: "in" | "out";
      quantity: number;
      reason: string;
      occurred_at: string;
      created_by: string | null;
    }> = [];

    for (const [ingredientId, total] of totals) {
      const current = stockMap.get(ingredientId) ?? 0;
      const delta = total - current;
      if (delta === 0) continue;
      movements.push({
        restaurant_id: inv.restaurant_id,
        ingredient_id: ingredientId,
        type: delta > 0 ? "in" : "out",
        quantity: Math.abs(delta),
        reason: reasonBase,
        occurred_at: now,
        created_by: userId ?? null,
      });
    }

    if (movements.length > 0) {
      // Trigger apply_stock_movement updates ingredients.current_stock automatically
      const { error: mErr } = await supabaseAdmin.from("stock_movements").insert(movements);
      if (mErr) throw new Error(mErr.message);
    }

    // Limpa todos os dados do link de inventário: zera contagens e
    // atualiza expected_qty para o estoque recém-calculado.
    const { error: rErr } = await supabaseAdmin
      .from("inventory_items")
      .update({ counted_qty: null })
      .eq("inventory_id", data.inventoryId);
    if (rErr) throw new Error(rErr.message);

    for (const [ingredientId, total] of totals) {
      const { error: eqErr } = await supabaseAdmin
        .from("inventory_items")
        .update({ expected_qty: total })
        .eq("inventory_id", data.inventoryId)
        .eq("ingredient_id", ingredientId);
      if (eqErr) throw new Error(eqErr.message);
    }

    const { error: doneErr } = await supabaseAdmin
      .from("inventories")
      .update({ last_completed_at: now, status: "pending", completed_at: now })
      .eq("id", data.inventoryId);
    if (doneErr) throw new Error(doneErr.message);

    return { ok: true, updated: totals.size, movements: movements.length };
  });
