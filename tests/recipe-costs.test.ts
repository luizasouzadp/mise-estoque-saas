import { describe, expect, it } from "vitest";
import { recipeUnitCosts } from "@/lib/recipe-costs";

const now = new Date().toISOString();
const old = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

const tables: Record<string, any[]> = {
  recipes: [
    ...Array.from({ length: 80 }, (_, i) => ({ id: `r${i}`, yield_qty: 2 })),
    { id: "molho", yield_qty: 4 },
  ],
  recipe_items: [
    ...Array.from({ length: 80 }, (_, i) => [
      { recipe_id: `r${i}`, item_type: "ingredient", quantity: 1, ingredient_id: "farinha", sub_recipe_id: null },
      { recipe_id: `r${i}`, item_type: "recipe", quantity: 2, ingredient_id: null, sub_recipe_id: "molho" },
    ]).flat(),
    { recipe_id: "molho", item_type: "ingredient", quantity: 2, ingredient_id: "tomate", sub_recipe_id: null },
    { recipe_id: "molho", item_type: "ingredient", quantity: 1, ingredient_id: "queijo", sub_recipe_id: null },
  ],
  ingredients: [
    { id: "farinha", source_recipe_id: null, avg_cost: 99, last_cost: 99 },
    { id: "tomate", source_recipe_id: null, avg_cost: 99, last_cost: 99 },
    { id: "queijo", source_recipe_id: null, avg_cost: 0, last_cost: 7 },
  ],
  purchases: [
    { id: "p1", ingredient_id: "farinha", quantity: 10, total_cost: 40, purchased_at: now },
    { id: "p2", ingredient_id: "farinha", quantity: 10, total_cost: 1000, purchased_at: old },
    { id: "p3", ingredient_id: "tomate", quantity: 4, total_cost: 12, purchased_at: old },
  ],
};

function fakeClient() {
  let calls = 0;
  const client = {
    get calls() {
      return calls;
    },
    rpc: async () => {
      calls++;
      return { data: null, error: { message: "function not found" } };
    },
    from(table: string) {
      let rows = tables[table];
      const q: any = {
        select: () => q,
        in: (col: string, vals: string[]) => {
          rows = rows.filter((r) => vals.includes(r[col]));
          return q;
        },
        order: () => q,
        range: (a: number, b: number) => {
          rows = rows.slice(a, b + 1);
          return q;
        },
        then: (res: any) => {
          calls++;
          return Promise.resolve({ data: rows, error: null }).then(res);
        },
      };
      return q;
    },
  };
  return client;
}

describe("recipeUnitCosts fallback", () => {
  it("computes costs with a bounded number of calls", async () => {
    const client = fakeClient();
    const ids = Array.from({ length: 80 }, (_, i) => `r${i}`);
    const costs = await recipeUnitCosts(client, ids);
    // farinha: 4 (last 30d); molho total = 2*3 (tomate, all-time) + 1*7 (queijo fallback) = 13, /4 = 3.25
    // r: (1*4 + 2*3.25) / 2 = 5.25
    expect(costs.get("r0")).toBeCloseTo(5.25);
    expect(costs.get("r79")).toBeCloseTo(5.25);
    expect(client.calls).toBeLessThan(15);
  });
});
