import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const SalesRowSchema = z.object({
  product_code: z.string().trim().min(1),
  quantity: z.number().nonnegative(),
  unit_price: z.number().nonnegative().nullable().optional(),
});

const CreateDailySchema = z.object({
  sales_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  file_name: z.string().optional(),
  rows: z.array(SalesRowSchema).min(1),
});

type RecipeExpand = {
  id: string;
  yield_qty: number | null;
  recipe_items: Array<{
    item_type: "ingredient" | "recipe";
    ingredient_id: string | null;
    sub_recipe_id: string | null;
    quantity: number | null;
  }>;
};

type MenuProductExpand = {
  id: string;
  items: Array<{ ref_type: "ingredient" | "recipe"; ref_id: string; quantity: number }> | null;
};

/**
 * Given the per-product quantities sold and the recipe/menu graph, returns
 * a map ingredient_id → theoretical consumption for the sales.
 * Mirrors the logic in cmv.index.tsx (respects yield_qty, sub-recipes and
 * stocked preparations via ingredients.source_recipe_id).
 */
function expandConsumption(
  quantities: Map<string, number>, // key: `rec:${id}` or `mp:${id}`
  recipes: RecipeExpand[],
  menuProducts: MenuProductExpand[],
  ingredientsList: Array<{ id: string; source_recipe_id: string | null; composes_cmv: boolean }>,
): Map<string, number> {
  const recipeMap = new Map(recipes.map((r) => [r.id, r]));
  const menuMap = new Map(menuProducts.map((m) => [m.id, m]));
  const stockedRecipeToIng = new Map<string, string>();
  const cmvIngSet = new Set<string>();
  for (const i of ingredientsList) {
    if (i.composes_cmv) cmvIngSet.add(i.id);
    if (i.source_recipe_id) stockedRecipeToIng.set(i.source_recipe_id, i.id);
  }
  const theoretical = new Map<string, number>();

  function addRecipe(recipeId: string, mult: number, depth = 0) {
    if (depth > 10 || !mult) return;
    const r = recipeMap.get(recipeId);
    if (!r) return;
    for (const it of r.recipe_items ?? []) {
      const iq = Number(it.quantity ?? 0);
      if (!iq) continue;
      if (it.item_type === "ingredient" && it.ingredient_id) {
        theoretical.set(it.ingredient_id, (theoretical.get(it.ingredient_id) ?? 0) + mult * iq);
      } else if (it.item_type === "recipe" && it.sub_recipe_id) {
        const stockedIng = stockedRecipeToIng.get(it.sub_recipe_id);
        if (stockedIng) {
          theoretical.set(stockedIng, (theoretical.get(stockedIng) ?? 0) + mult * iq);
        } else {
          const sub = recipeMap.get(it.sub_recipe_id);
          const y = Number(sub?.yield_qty ?? 1) || 1;
          addRecipe(it.sub_recipe_id, (mult * iq) / y, depth + 1);
        }
      }
    }
  }

  for (const [pid, q] of quantities) {
    if (!q) continue;
    if (pid.startsWith("mp:")) {
      const mp = menuMap.get(pid.slice(3));
      if (!mp) continue;
      for (const it of mp.items ?? []) {
        const iq = Number(it.quantity ?? 0);
        if (!it.ref_id || !iq) continue;
        if (it.ref_type === "ingredient") {
          theoretical.set(it.ref_id, (theoretical.get(it.ref_id) ?? 0) + q * iq);
        } else if (it.ref_type === "recipe") {
          const stockedIng = stockedRecipeToIng.get(it.ref_id);
          if (stockedIng) {
            theoretical.set(stockedIng, (theoretical.get(stockedIng) ?? 0) + q * iq);
          } else {
            const sub = recipeMap.get(it.ref_id);
            const y = Number(sub?.yield_qty ?? 1) || 1;
            addRecipe(it.ref_id, (q * iq) / y);
          }
        }
      }
    } else if (pid.startsWith("rec:")) {
      const rid = pid.slice(4);
      const stockedIng = stockedRecipeToIng.get(rid);
      if (stockedIng) {
        theoretical.set(stockedIng, (theoretical.get(stockedIng) ?? 0) + q);
      } else {
        const sub = recipeMap.get(rid);
        const y = Number(sub?.yield_qty ?? 1) || 1;
        addRecipe(rid, q / y);
      }
    }
  }

  // Keep only CMV-composing ingredients
  const filtered = new Map<string, number>();
  for (const [id, qty] of theoretical) if (cmvIngSet.has(id)) filtered.set(id, qty);
  return filtered;
}

export const createDailySalesReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => CreateDailySchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: prof } = await supabase
      .from("profiles").select("restaurant_id").eq("id", userId).maybeSingle();
    if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");
    const restaurantId = prof.restaurant_id;

    // 1) Build product_code → {source, id, price} lookup
    const [{ data: recipes }, { data: mpAll }] = await Promise.all([
      supabase.from("recipes")
        .select("id, name, current_price, product_code")
        .eq("is_on_menu", true)
        .not("product_code", "is", null),
      (supabase as unknown as { from: (t: string) => { select: (s: string) => { not: (a: string, b: string, c: unknown) => Promise<{ data: unknown[] | null }> } } })
        .from("menu_products")
        .select("id, name, current_price, cost, product_code")
        .not("product_code", "is", null),
    ]);
    type Prod = { key: string; price: number; cost: number };
    const lookup = new Map<string, Prod>();
    for (const r of recipes ?? []) {
      const code = String(r.product_code ?? "").trim();
      if (!code) continue;
      lookup.set(code, {
        key: `rec:${r.id}`,
        price: Number(r.current_price ?? 0),
        cost: 0,
      });
    }
    for (const m of (mpAll as Array<{ id: string; current_price: number | null; cost: number | null; product_code: string }> | null) ?? []) {
      const code = String(m.product_code ?? "").trim();
      if (!code) continue;
      lookup.set(code, {
        key: `mp:${m.id}`,
        price: Number(m.current_price ?? 0),
        cost: Number(m.cost ?? 0),
      });
    }

    // 2) Aggregate rows by product code (weighted price)
    type Agg = { quantity: number; revenue_with_price: number; qty_with_price: number };
    const agg = new Map<string, Agg>();
    for (const row of data.rows) {
      const code = row.product_code.trim();
      const cur = agg.get(code) ?? { quantity: 0, revenue_with_price: 0, qty_with_price: 0 };
      cur.quantity += row.quantity;
      if (row.unit_price != null && row.unit_price > 0) {
        cur.revenue_with_price += row.unit_price * row.quantity;
        cur.qty_with_price += row.quantity;
      }
      agg.set(code, cur);
    }

    // 3) Build map product_key → qty (for expansion)
    const productQty = new Map<string, number>();
    let totalRevenue = 0;
    let totalQuantity = 0;
    let mapped = 0;
    let unmapped = 0;
    for (const [code, a] of agg) {
      const res = lookup.get(code);
      totalQuantity += a.quantity;
      if (!res) { unmapped++; continue; }
      mapped++;
      const unitPrice = a.qty_with_price > 0 ? a.revenue_with_price / a.qty_with_price : res.price;
      totalRevenue += unitPrice * a.quantity;
      productQty.set(res.key, (productQty.get(res.key) ?? 0) + a.quantity);
    }

    // 4) Fetch recipe graph + menu items + ingredients (RLS scopes to restaurant)
    const [{ data: recExpand }, { data: mpExpand }, { data: ingList }] = await Promise.all([
      supabase.from("recipes")
        .select("id, yield_qty, recipe_items!recipe_items_recipe_id_fkey(item_type, ingredient_id, sub_recipe_id, quantity)"),
      (supabase as unknown as { from: (t: string) => { select: (s: string) => Promise<{ data: unknown[] | null }> } })
        .from("menu_products").select("id, items"),
      supabase.from("ingredients").select("id, source_recipe_id, composes_cmv"),
    ]);

    const theoretical = expandConsumption(
      productQty,
      (recExpand ?? []) as unknown as RecipeExpand[],
      (mpExpand ?? []) as unknown as MenuProductExpand[],
      (ingList ?? []) as Array<{ id: string; source_recipe_id: string | null; composes_cmv: boolean }>,
    );

    // 5) Upsert daily_sales_reports by (restaurant_id, sales_date), replacing prior day.
    // First delete previous report for this date (cascades consumption rows).
    await supabase.from("daily_sales_reports")
      .delete().eq("restaurant_id", restaurantId).eq("sales_date", data.sales_date);

    const { data: inserted, error: insErr } = await supabase
      .from("daily_sales_reports")
      .insert({
        restaurant_id: restaurantId,
        sales_date: data.sales_date,
        file_name: data.file_name ?? null,
        total_revenue: Number(totalRevenue.toFixed(2)),
        total_quantity: Number(totalQuantity.toFixed(3)),
        mapped_count: mapped,
        unmapped_count: unmapped,
        created_by: userId ?? null,
      })
      .select("id").single();
    if (insErr || !inserted) throw new Error(insErr?.message ?? "Falha ao gravar relatório diário");

    // 6) Insert per-ingredient theoretical consumption
    if (theoretical.size > 0) {
      const rows = Array.from(theoretical.entries()).map(([ingredient_id, quantity_theoretical]) => ({
        daily_report_id: inserted.id,
        restaurant_id: restaurantId,
        ingredient_id,
        sales_date: data.sales_date,
        quantity_theoretical: Number(quantity_theoretical.toFixed(6)),
      }));
      const { error: cErr } = await supabase.from("daily_sales_consumption").insert(rows);
      if (cErr) throw new Error(cErr.message);
    }

    return { id: inserted.id, mapped, unmapped, ingredients: theoretical.size };
  });

const DeleteSchema = z.object({ id: z.string().uuid() });
export const deleteDailySalesReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => DeleteSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("daily_sales_reports").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
