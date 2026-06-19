import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const duplicateRecipe = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ recipeId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const supabase = context.supabase;

    // 1) Fetch original recipe
    const { data: original, error: origErr } = await supabase
      .from("recipes")
      .select("*")
      .eq("id", data.recipeId)
      .single();
    if (origErr || !original) throw new Error("Ficha não encontrada");

    // 2) Fetch items
    const { data: items, error: itemsErr } = await supabase
      .from("recipe_items")
      .select("item_type, ingredient_id, sub_recipe_id, quantity, unit")
      .eq("recipe_id", data.recipeId);
    if (itemsErr) throw itemsErr;

    // 3) Insert new recipe
    const newName = `Cópia de ${original.name}`;
    const { data: created, error: insertErr } = await supabase
      .from("recipes")
      .insert({
        restaurant_id: original.restaurant_id,
        name: newName,
        description: original.description,
        yield_qty: original.yield_qty,
        yield_unit: original.yield_unit,
        is_stocked: original.is_stocked,
        is_on_menu: original.is_on_menu,
        menu_category: original.menu_category,
        current_price: original.current_price,
        product_code: original.product_code,
      })
      .select("id")
      .single();
    if (insertErr || !created) throw insertErr ?? new Error("Erro ao duplicar ficha");

    // 4) Insert copied items
    if (items && items.length > 0) {
      const { error: itemInsertErr } = await supabase.from("recipe_items").insert(
        items.map((it) => ({
          recipe_id: created.id,
          item_type: it.item_type,
          ingredient_id: it.ingredient_id,
          sub_recipe_id: it.sub_recipe_id,
          quantity: it.quantity,
          unit: it.unit,
        }))
      );
      if (itemInsertErr) throw itemInsertErr;
    }

    // 5) If stocked, create mirror ingredient
    if (original.is_stocked) {
      const { data: unitCost } = await supabase.rpc("recipe_unit_cost", { _recipe_id: created.id });
      const cost = Number(unitCost ?? 0);
      await supabase.from("ingredients").insert({
        restaurant_id: original.restaurant_id,
        source_recipe_id: created.id,
        name: newName,
        unit: original.yield_unit,
        category: "pré-preparo",
        avg_cost: cost,
        last_cost: cost,
      });
    }

    return { id: created.id };
  });
