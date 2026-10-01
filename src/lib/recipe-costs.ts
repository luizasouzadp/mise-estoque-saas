// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

const CHUNK = 150;
const PAGE = 1000;
const MAX_DEPTH = 10;

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Unit cost of several recipes with a single database call (recipes_unit_costs),
 * so server functions stay under the Worker subrequest limit. If the batch
 * function isn't deployed, computes the same costs here with a few bulk queries
 * instead of one recipe_unit_cost call per recipe.
 */
export async function recipeUnitCosts(supabase: AnyClient, recipeIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = Array.from(new Set(recipeIds));
  if (ids.length === 0) return out;

  const { data, error } = await supabase.rpc("recipes_unit_costs", { _recipe_ids: ids });
  if (!error) {
    for (const row of (data ?? []) as { recipe_id: string; unit_cost: number | null }[]) {
      out.set(row.recipe_id, Number(row.unit_cost ?? 0));
    }
    return out;
  }

  return computeUnitCostsLocally(supabase, ids);
}

type Item = { item_type: string; quantity: number | null; ingredient_id: string | null; sub_recipe_id: string | null };
type Ingredient = { source_recipe_id: string | null; avg_cost: number | null; last_cost: number | null };

/**
 * Mirrors the database functions recipe_unit_cost / recipe_total_cost /
 * ingredient_avg_cost_last_30d, loading recipes, items, ingredients and
 * purchases in bulk.
 */
async function computeUnitCostsLocally(supabase: AnyClient, ids: string[]): Promise<Map<string, number>> {
  const yields = new Map<string, number>();
  const itemsByRecipe = new Map<string, Item[]>();
  const ingredients = new Map<string, Ingredient>();

  let pendingRecipes = ids;
  let pendingIngredients: string[] = [];
  while (pendingRecipes.length > 0 || pendingIngredients.length > 0) {
    const nextRecipes = new Set<string>();
    const nextIngredients = new Set<string>();

    for (const part of chunks(pendingRecipes)) {
      const [{ data: recs, error: rErr }, { data: items, error: iErr }] = await Promise.all([
        supabase.from("recipes").select("id, yield_qty").in("id", part),
        supabase.from("recipe_items").select("recipe_id, item_type, quantity, ingredient_id, sub_recipe_id").in("recipe_id", part),
      ]);
      if (rErr) throw new Error(rErr.message);
      if (iErr) throw new Error(iErr.message);
      for (const r of recs ?? []) yields.set(r.id, Number(r.yield_qty ?? 1));
      for (const id of part) itemsByRecipe.set(id, []);
      for (const it of (items ?? []) as (Item & { recipe_id: string })[]) {
        itemsByRecipe.get(it.recipe_id)?.push(it);
        if (it.item_type === "ingredient" && it.ingredient_id && !ingredients.has(it.ingredient_id)) {
          nextIngredients.add(it.ingredient_id);
        } else if (it.item_type === "recipe" && it.sub_recipe_id && !itemsByRecipe.has(it.sub_recipe_id)) {
          nextRecipes.add(it.sub_recipe_id);
        }
      }
    }

    for (const part of chunks(pendingIngredients)) {
      const { data: ings, error: gErr } = await supabase
        .from("ingredients")
        .select("id, source_recipe_id, avg_cost, last_cost")
        .in("id", part);
      if (gErr) throw new Error(gErr.message);
      for (const g of ings ?? []) {
        ingredients.set(g.id, g);
        if (g.source_recipe_id && !itemsByRecipe.has(g.source_recipe_id)) nextRecipes.add(g.source_recipe_id);
      }
    }

    pendingRecipes = Array.from(nextRecipes).filter((id) => !itemsByRecipe.has(id));
    pendingIngredients = Array.from(nextIngredients).filter((id) => !ingredients.has(id));
  }

  // Purchases of plain ingredients (those made from a recipe use the recipe cost).
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const totals = new Map<string, { qty: number; cost: number; qty30: number; cost30: number }>();
  const bought = Array.from(ingredients.entries())
    .filter(([, g]) => !g.source_recipe_id)
    .map(([id]) => id);
  for (const part of chunks(bought)) {
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error: pErr } = await supabase
        .from("purchases")
        .select("ingredient_id, quantity, total_cost, purchased_at")
        .in("ingredient_id", part)
        .order("id")
        .range(from, from + PAGE - 1);
      if (pErr) throw new Error(pErr.message);
      for (const p of rows ?? []) {
        const t = totals.get(p.ingredient_id) ?? { qty: 0, cost: 0, qty30: 0, cost30: 0 };
        const q = Number(p.quantity ?? 0);
        const c = Number(p.total_cost ?? 0);
        t.qty += q;
        t.cost += c;
        if (new Date(p.purchased_at).getTime() >= since) {
          t.qty30 += q;
          t.cost30 += c;
        }
        totals.set(p.ingredient_id, t);
      }
      if (!rows || rows.length < PAGE) break;
    }
  }

  const unitMemo = new Map<string, number>();
  const visiting = new Set<string>();

  function ingredientCost(id: string): number {
    const g = ingredients.get(id);
    if (g?.source_recipe_id) return unitCost(g.source_recipe_id);
    const t = totals.get(id);
    if (t && t.qty30 > 0) return t.cost30 / t.qty30;
    if (t && t.qty > 0) return t.cost / t.qty;
    return Number(g?.avg_cost) || Number(g?.last_cost) || 0;
  }

  function totalCost(recipeId: string, depth: number): number {
    if (depth > MAX_DEPTH) return 0;
    let total = 0;
    for (const it of itemsByRecipe.get(recipeId) ?? []) {
      const q = Number(it.quantity ?? 0);
      if (it.item_type === "ingredient" && it.ingredient_id) {
        total += q * ingredientCost(it.ingredient_id);
      } else if (it.item_type === "recipe" && it.sub_recipe_id) {
        const y = yields.get(it.sub_recipe_id) ?? 1;
        if (y > 0) total += q * (totalCost(it.sub_recipe_id, depth + 1) / y);
      }
    }
    return total;
  }

  function unitCost(recipeId: string): number {
    const memo = unitMemo.get(recipeId);
    if (memo !== undefined) return memo;
    if (visiting.has(recipeId)) return 0;
    visiting.add(recipeId);
    const y = yields.get(recipeId) ?? 1;
    const v = y > 0 ? totalCost(recipeId, 0) / y : 0;
    visiting.delete(recipeId);
    unitMemo.set(recipeId, v);
    return v;
  }

  const out = new Map<string, number>();
  for (const id of ids) out.set(id, unitCost(id));
  return out;
}
