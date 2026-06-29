import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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

    // 1) stock_movements: multiply quantity by factor, divide unit_cost
    const { data: mvs } = await supabaseAdmin
      .from("stock_movements")
      .select("id, quantity, unit_cost")
      .eq("ingredient_id", ingredientId);
    for (const m of mvs ?? []) {
      await supabaseAdmin
        .from("stock_movements")
        .update({
          quantity: Number(m.quantity) * factor,
          unit_cost: m.unit_cost == null ? null : Number(m.unit_cost) / factor,
        })
        .eq("id", m.id);
    }

    // 2) purchases: multiply quantity, divide unit_cost (total_cost unchanged)
    const { data: pus } = await supabaseAdmin
      .from("purchases")
      .select("id, quantity, unit_cost")
      .eq("ingredient_id", ingredientId);
    for (const p of pus ?? []) {
      await supabaseAdmin
        .from("purchases")
        .update({
          quantity: Number(p.quantity) * factor,
          unit_cost: Number(p.unit_cost) / factor,
        })
        .eq("id", p.id);
    }

    // 3) recipe_items where unit matches old unit
    const { data: ris } = await supabaseAdmin
      .from("recipe_items")
      .select("id, quantity, unit")
      .eq("ingredient_id", ingredientId)
      .eq("unit", oldUnit);
    for (const r of ris ?? []) {
      await supabaseAdmin
        .from("recipe_items")
        .update({ quantity: Number(r.quantity) * factor, unit: newUnit })
        .eq("id", r.id);
    }

    // 4) inventory_items
    const { data: invs } = await supabaseAdmin
      .from("inventory_items")
      .select("id, expected_qty, counted_qty")
      .eq("ingredient_id", ingredientId);
    for (const it of invs ?? []) {
      await supabaseAdmin
        .from("inventory_items")
        .update({
          expected_qty: it.expected_qty == null ? null : Number(it.expected_qty) * factor,
          counted_qty: it.counted_qty == null ? null : Number(it.counted_qty) * factor,
          unit: newUnit,
        })
        .eq("id", it.id);
    }

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
