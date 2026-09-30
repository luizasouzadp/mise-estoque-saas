// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = any;

/**
 * Unit cost of several recipes with a single database call (recipes_unit_costs),
 * so server functions stay under the Worker subrequest limit. Falls back to one
 * recipe_unit_cost call per recipe if the batch function isn't deployed yet.
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

  for (const id of ids) {
    const { data: uc } = await supabase.rpc("recipe_unit_cost", { _recipe_id: id });
    out.set(id, Number(uc ?? 0));
  }
  return out;
}
