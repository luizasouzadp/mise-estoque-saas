import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getInventoryByToken = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: session, error } = await supabaseAdmin
      .from("inventory_sessions")
      .select("id, status, completed_at, group_id, inventory_id, assigned_to")
      .eq("public_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session) throw new Error("Sessão não encontrada");

    const { data: inv, error: invErr } = await supabaseAdmin
      .from("inventories")
      .select("id, status, restaurant_id, created_at")
      .eq("id", session.inventory_id)
      .single();
    if (invErr) throw new Error(invErr.message);

    const [{ data: rest }, { data: group }, { data: items }] = await Promise.all([
      supabaseAdmin.from("restaurants").select("name").eq("id", inv.restaurant_id).maybeSingle(),
      session.group_id
        ? supabaseAdmin.from("ingredient_groups").select("name").eq("id", session.group_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin
        .from("inventory_items")
        .select("id, ingredient_name, unit, expected_qty, counted_qty")
        .eq("session_id", session.id)
        .order("ingredient_name"),
    ]);

    return {
      sessionId: session.id,
      inventoryId: inv.id,
      sessionStatus: session.status,
      inventoryStatus: inv.status,
      completedAt: session.completed_at,
      assignedTo: session.assigned_to,
      restaurantName: rest?.name ?? "Restaurante",
      groupName: group?.name ?? null,
      items: items ?? [],
    };
  });

export const submitInventoryCount = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        token: z.string().uuid(),
        counts: z
          .array(z.object({ itemId: z.string().uuid(), countedQty: z.number().min(0) }))
          .min(1)
          .max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { data: session, error } = await supabaseAdmin
      .from("inventory_sessions")
      .select("id, status, inventory_id")
      .eq("public_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!session) throw new Error("Sessão não encontrada");
    if (session.status === "completed") throw new Error("Esta contagem já foi enviada");

    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("inventory_items")
      .select("id")
      .eq("session_id", session.id);
    if (itemsErr) throw new Error(itemsErr.message);
    const validIds = new Set((items ?? []).map((i) => i.id));

    for (const c of data.counts) {
      if (!validIds.has(c.itemId)) continue;
      const { error: upErr } = await supabaseAdmin
        .from("inventory_items")
        .update({ counted_qty: c.countedQty })
        .eq("id", c.itemId);
      if (upErr) throw new Error(upErr.message);
    }

    const { error: doneErr } = await supabaseAdmin
      .from("inventory_sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", session.id);
    if (doneErr) throw new Error(doneErr.message);

    return { ok: true };
  });

// Admin finalizes the whole inventory day: sums counted_qty per ingredient
// across all sessions and updates ingredients.current_stock.
export const finalizeInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ inventoryId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    // Authorize: inventory must belong to caller's restaurant
    const { data: inv, error: invErr } = await supabase
      .from("inventories")
      .select("id, status, restaurant_id")
      .eq("id", data.inventoryId)
      .maybeSingle();
    if (invErr) throw new Error(invErr.message);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status === "completed") throw new Error("Este inventário já foi finalizado");

    // Sum counted_qty per ingredient across all sessions of this inventory
    const { data: sessions, error: sErr } = await supabaseAdmin
      .from("inventory_sessions")
      .select("id")
      .eq("inventory_id", data.inventoryId);
    if (sErr) throw new Error(sErr.message);
    const sessionIds = (sessions ?? []).map((s) => s.id);
    if (sessionIds.length === 0) throw new Error("Inventário sem sessões");

    const { data: items, error: iErr } = await supabaseAdmin
      .from("inventory_items")
      .select("ingredient_id, counted_qty")
      .in("session_id", sessionIds);
    if (iErr) throw new Error(iErr.message);

    const totals = new Map<string, number>();
    let countedSomething = false;
    for (const it of items ?? []) {
      if (it.counted_qty == null) continue;
      countedSomething = true;
      totals.set(
        it.ingredient_id,
        (totals.get(it.ingredient_id) ?? 0) + Number(it.counted_qty),
      );
    }
    if (!countedSomething) throw new Error("Nenhuma contagem registrada ainda");

    for (const [ingredientId, total] of totals) {
      const { error: upErr } = await supabaseAdmin
        .from("ingredients")
        .update({ current_stock: total })
        .eq("id", ingredientId)
        .eq("restaurant_id", inv.restaurant_id);
      if (upErr) throw new Error(upErr.message);
    }

    const { error: doneErr } = await supabaseAdmin
      .from("inventories")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", data.inventoryId);
    if (doneErr) throw new Error(doneErr.message);

    return { ok: true, updated: totals.size };
  });
