import type { SupabaseClient } from "@supabase/supabase-js";
import { convert } from "../../units";

export type DailyOut = { date: string; qty: number };

const PAGE = 1000;

type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

// Busca todas as linhas de uma consulta em páginas (a API devolve no máximo 1000 por vez).
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<QueryResult<T>>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

function dayKeysSince(days: number): { since: Date; keys: string[] } {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const keys: string[] = [];
  const cursor = new Date(since);
  const today = new Date();
  while (cursor <= today) {
    keys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return { since, keys };
}

/** Série zerada para insumos sem nenhum consumo no período. */
export function emptySeries(days: number): DailyOut[] {
  return dayKeysSince(days).keys.map((date) => ({ date, qty: 0 }));
}

export function totalOut(series: DailyOut[]): number {
  return series.reduce((a, d) => a + d.qty, 0);
}

// ---------------------------------------------------------------------------
// Fichas técnicas → "lista de materiais" dos pré-preparos
// ---------------------------------------------------------------------------

type GraphIngredient = {
  id: string;
  unit: string;
  category: string | null;
  current_stock: number | null;
  is_active: boolean;
  source_recipe_id: string | null;
};

type GraphRecipe = {
  id: string;
  yield_qty: number | null;
  yield_unit: string | null;
  recipe_items: Array<{
    item_type: string;
    ingredient_id: string | null;
    sub_recipe_id: string | null;
    quantity: number | null;
    unit: string | null;
  }> | null;
};

export type RecipeGraph = {
  ingredients: Map<string, GraphIngredient>;
  /** pré-preparo → (insumo da ficha → quantidade por 1 unidade do pré-preparo) */
  bom: Map<string, Map<string, number>>;
  /** insumo → pré-preparos que o usam, com a quantidade por unidade do pré-preparo */
  parents: Map<string, Array<{ prep: string; factor: number }>>;
};

function normalize(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Itens produzidos internamente: resultado de uma ficha ou categoria "pré-preparo". */
export function isInternallyProduced(i: {
  source_recipe_id?: string | null;
  category?: string | null;
}): boolean {
  if (i.source_recipe_id) return true;
  const c = normalize(i.category);
  return c === "pre preparo" || c === "pre preparos";
}

export async function loadRecipeGraph(supabase: SupabaseClient): Promise<RecipeGraph> {
  const [ingList, recipes] = await Promise.all([
    fetchAll<GraphIngredient>((from, to) =>
      supabase
        .from("ingredients")
        .select("id, unit, category, current_stock, is_active, source_recipe_id")
        .order("id")
        .range(from, to) as unknown as PromiseLike<QueryResult<GraphIngredient>>,
    ),
    fetchAll<GraphRecipe>((from, to) =>
      supabase
        .from("recipes")
        .select(
          "id, yield_qty, yield_unit, recipe_items!recipe_items_recipe_id_fkey(item_type, ingredient_id, sub_recipe_id, quantity, unit)",
        )
        .order("id")
        .range(from, to) as unknown as PromiseLike<QueryResult<GraphRecipe>>,
    ),
  ]);

  const ingredients = new Map(ingList.map((i) => [i.id, i]));
  const recipeMap = new Map(recipes.map((r) => [r.id, r]));
  const stockedRecipeToIng = new Map<string, string>();
  for (const i of ingList) if (i.source_recipe_id) stockedRecipeToIng.set(i.source_recipe_id, i.id);

  // Converte para a unidade do insumo quando possível (kg↔g, L↔ml); senão usa como está.
  const toUnit = (qty: number, from: string | null, to: string | undefined) =>
    (from && to ? convert(qty, from, to) : null) ?? qty;

  function expand(recipeId: string, mult: number, acc: Map<string, number>, depth: number) {
    if (depth > 10 || !mult) return;
    const r = recipeMap.get(recipeId);
    if (!r) return;
    for (const it of r.recipe_items ?? []) {
      const iq = Number(it.quantity ?? 0);
      if (!iq) continue;
      if (it.item_type === "ingredient" && it.ingredient_id) {
        const q = toUnit(iq, it.unit, ingredients.get(it.ingredient_id)?.unit);
        acc.set(it.ingredient_id, (acc.get(it.ingredient_id) ?? 0) + mult * q);
      } else if (it.item_type === "recipe" && it.sub_recipe_id) {
        const stockedIng = stockedRecipeToIng.get(it.sub_recipe_id);
        if (stockedIng) {
          // Sub-ficha que também fica em estoque: vira um "insumo" desta ficha.
          const q = toUnit(iq, it.unit, ingredients.get(stockedIng)?.unit);
          acc.set(stockedIng, (acc.get(stockedIng) ?? 0) + mult * q);
        } else {
          const sub = recipeMap.get(it.sub_recipe_id);
          const q = toUnit(iq, it.unit, sub?.yield_unit ?? undefined);
          const y = Number(sub?.yield_qty ?? 1) || 1;
          expand(it.sub_recipe_id, (mult * q) / y, acc, depth + 1);
        }
      }
    }
  }

  const bom = new Map<string, Map<string, number>>();
  const parents = new Map<string, Array<{ prep: string; factor: number }>>();
  for (const prep of ingList) {
    if (!prep.source_recipe_id) continue;
    const r = recipeMap.get(prep.source_recipe_id);
    if (!r) continue;
    const yieldInPrepUnit = toUnit(Number(r.yield_qty ?? 1) || 1, r.yield_unit, prep.unit) || 1;
    const acc = new Map<string, number>();
    expand(r.id, 1 / yieldInPrepUnit, acc, 0);
    acc.delete(prep.id);
    if (acc.size === 0) continue;
    bom.set(prep.id, acc);
    for (const [child, factor] of acc) {
      const list = parents.get(child) ?? [];
      list.push({ prep: prep.id, factor });
      parents.set(child, list);
    }
  }
  return { ingredients, bom, parents };
}

/**
 * Propaga um valor dos pré-preparos para os insumos das fichas:
 *   total(x) = próprio(x) + Σ total(pré-preparo) × quantidade de x na ficha
 * Funciona em vários níveis (pré-preparo dentro de pré-preparo) e ignora ciclos.
 */
function propagate<V>(
  graph: RecipeGraph,
  own: (id: string) => V,
  add: (acc: V, parentTotal: V, factor: number, prep: string) => V,
): (id: string) => V {
  const memo = new Map<string, V>();
  const visiting = new Set<string>();
  const total = (id: string): V => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    let v = own(id);
    if (visiting.has(id)) return v;
    visiting.add(id);
    for (const { prep, factor } of graph.parents.get(id) ?? []) {
      v = add(v, total(prep), factor, prep);
    }
    visiting.delete(id);
    memo.set(id, v);
    return v;
  };
  return total;
}

// ---------------------------------------------------------------------------
// Consumo e estoque efetivo
// ---------------------------------------------------------------------------

/**
 * Consumo diário de todos os insumos do restaurante nos últimos N dias:
 *   consumo = saídas diretas (exceto as de "Produção") + consumo explodido dos pré-preparos.
 * As saídas das contagens ("Inventário · ...") contam como consumo.
 * Faz poucas consultas no total, para não estourar o limite do Cloudflare Worker.
 */
export async function dailyConsumptionAll(
  supabase: SupabaseClient,
  days: number,
  graph?: RecipeGraph,
): Promise<Map<string, DailyOut[]>> {
  const { since, keys } = dayKeysSince(days);
  const sinceIso = since.toISOString();
  const dayIndex = new Map(keys.map((k, i) => [k, i]));

  type MvRow = {
    ingredient_id: string;
    quantity: number;
    occurred_at: string;
    reason: string | null;
    notes: string | null;
  };
  const [mv, g] = await Promise.all([
    fetchAll<MvRow>((from, to) =>
      supabase
        .from("stock_movements")
        .select("ingredient_id, quantity, occurred_at, reason, notes")
        .eq("type", "out")
        .gte("occurred_at", sinceIso)
        .order("id")
        .range(from, to) as unknown as PromiseLike<QueryResult<MvRow>>,
    ),
    graph ? Promise.resolve(graph) : loadRecipeGraph(supabase),
  ]);

  // Consumo direto. Saídas de "Produção" são insumo virando pré-preparo, não consumo:
  // o consumo real desses insumos vem do consumo do pré-preparo (explodido abaixo).
  const direct = new Map<string, number[]>();
  for (const m of mv) {
    if (m.reason === "Produção" || (m.notes ?? "").startsWith("production:")) continue;
    const idx = dayIndex.get(new Date(m.occurred_at).toISOString().slice(0, 10));
    if (idx === undefined) continue;
    let arr = direct.get(m.ingredient_id);
    if (!arr) direct.set(m.ingredient_id, (arr = new Array(keys.length).fill(0)));
    arr[idx] += Number(m.quantity ?? 0);
  }

  const zeros = new Array<number>(keys.length).fill(0);
  const total = propagate<number[]>(
    g,
    (id) => direct.get(id) ?? zeros,
    (acc, parent, factor) => acc.map((v, i) => v + parent[i] * factor),
  );

  const ids = new Set<string>([...direct.keys(), ...g.parents.keys()]);
  const result = new Map<string, DailyOut[]>();
  for (const id of ids) {
    const arr = total(id);
    if (arr.every((v) => v === 0)) continue;
    result.set(id, keys.map((date, i) => ({ date, qty: arr[i] })));
  }
  return result;
}

/** Consumo diário de um insumo (mesma regra de `dailyConsumptionAll`). */
export async function dailyConsumption(
  supabase: SupabaseClient,
  ingredientId: string,
  days: number,
): Promise<DailyOut[]> {
  const all = await dailyConsumptionAll(supabase, days);
  return all.get(ingredientId) ?? emptySeries(days);
}

/**
 * Estoque efetivo = estoque do insumo + Σ estoque dos pré-preparos × quantidade na ficha.
 * Só considera pré-preparos ativos e com estoque positivo.
 */
export function effectiveStockAll(graph: RecipeGraph): Map<string, number> {
  const stockOf = (id: string) => Number(graph.ingredients.get(id)?.current_stock ?? 0);
  const total = propagate<number>(
    graph,
    stockOf,
    (acc, parentTotal, factor, prep) =>
      graph.ingredients.get(prep)?.is_active === false
        ? acc
        : acc + Math.max(0, parentTotal) * factor,
  );
  const out = new Map<string, number>();
  for (const id of graph.ingredients.keys()) out.set(id, total(id));
  return out;
}

export async function effectiveStock(supabase: SupabaseClient, ingredientId: string) {
  const graph = await loadRecipeGraph(supabase);
  return effectiveStockAll(graph).get(ingredientId) ?? null;
}

export { normalize as normalizeName };
