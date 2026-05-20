import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export const getInventoryByToken = createServerFn({ method: "GET" })
  .inputValidator((input) => z.object({ token: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const { data: inv, error } = await supabaseAdmin
      .from("inventories")
      .select("id, status, scheduled_for, completed_at, group_id, restaurant_id")
      .eq("public_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Inventário não encontrado");

    const [{ data: rest }, { data: group }, { data: items }] = await Promise.all([
      supabaseAdmin.from("restaurants").select("name").eq("id", inv.restaurant_id).maybeSingle(),
      inv.group_id
        ? supabaseAdmin.from("ingredient_groups").select("name").eq("id", inv.group_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabaseAdmin
        .from("inventory_items")
        .select("id, ingredient_name, unit, expected_qty, counted_qty")
        .eq("inventory_id", inv.id)
        .order("ingredient_name"),
    ]);

    return {
      id: inv.id,
      status: inv.status,
      scheduledFor: inv.scheduled_for,
      completedAt: inv.completed_at,
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
    const { data: inv, error } = await supabaseAdmin
      .from("inventories")
      .select("id, status")
      .eq("public_token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!inv) throw new Error("Inventário não encontrado");
    if (inv.status === "completed") throw new Error("Esta contagem já foi finalizada");

    const { data: items, error: itemsErr } = await supabaseAdmin
      .from("inventory_items")
      .select("id, ingredient_id")
      .eq("inventory_id", inv.id);
    if (itemsErr) throw new Error(itemsErr.message);

    const itemMap = new Map(items?.map((i) => [i.id, i.ingredient_id]) ?? []);

    for (const c of data.counts) {
      const ingredientId = itemMap.get(c.itemId);
      if (!ingredientId) continue;
      const { error: upErr } = await supabaseAdmin
        .from("inventory_items")
        .update({ counted_qty: c.countedQty })
        .eq("id", c.itemId);
      if (upErr) throw new Error(upErr.message);
      const { error: ingErr } = await supabaseAdmin
        .from("ingredients")
        .update({ current_stock: c.countedQty })
        .eq("id", ingredientId);
      if (ingErr) throw new Error(ingErr.message);
    }

    const { error: doneErr } = await supabaseAdmin
      .from("inventories")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (doneErr) throw new Error(doneErr.message);

    return { ok: true };
  });
