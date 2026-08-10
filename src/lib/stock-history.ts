import { supabase } from "@/integrations/supabase/client";

export type HistIngredient = {
  id: string;
  name: string;
  unit: string;
  category: string | null;
  created_at: string;
  avg_cost: number;
  current_stock: number;
  min_stock: number;
  is_active: boolean | null;
};

export type UnifiedSource = "manual" | "purchase" | "inventory" | "production";

export type UnifiedMove = {
  key: string;
  source: UnifiedSource;
  ingredient_id: string;
  type: "in" | "out";
  quantity: number;
  reason: string;
  occurred_at: string;
  value: number;
};

export const sourceLabel: Record<UnifiedSource, string> = {
  manual: "Manual",
  purchase: "Compra",
  inventory: "Inventário",
  production: "Produção",
};

/** Parse a yyyy-mm-dd string as a local Date (start or end of day). */
export function parseLocal(s: string, end = false): Date | null {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (end) d.setHours(23, 59, 59, 999);
  return d;
}

type StockMovementRow = {
  id: string;
  ingredient_id: string;
  type: "in" | "out";
  quantity: number;
  unit_cost: number | null;
  reason: string | null;
  notes: string | null;
  occurred_at: string;
};
type PurchaseRow = {
  id: string;
  ingredient_id: string;
  quantity: number;
  unit_cost: number;
  supplier: string | null;
  purchased_at: string;
};
type InventoryItemRow = {
  id: string;
  ingredient_id: string;
  counted_qty: number | null;
  expected_qty: number;
  inventories: { name: string | null; completed_at: string | null; status: string } | null;
};
type ProductionItemRow = { production_id: string; ingredient_id: string; quantity: number };

export async function loadStockHistory(): Promise<{
  ingredients: HistIngredient[];
  moves: UnifiedMove[];
}> {
  const [ing, mv, pur, inv, pi] = await Promise.all([
    supabase
      .from("ingredients")
      .select("id, name, unit, category, created_at, avg_cost, current_stock, min_stock, is_active")
      .order("name"),
    supabase
      .from("stock_movements")
      .select("id, ingredient_id, type, quantity, unit_cost, reason, notes, occurred_at")
      .order("occurred_at", { ascending: false })
      .limit(5000),
    supabase
      .from("purchases")
      .select("id, ingredient_id, quantity, unit_cost, supplier, purchased_at")
      .order("purchased_at", { ascending: false })
      .limit(5000),
    supabase
      .from("inventory_items")
      .select(
        "id, ingredient_id, counted_qty, expected_qty, inventories!inner(name, completed_at, status)",
      )
      .not("counted_qty", "is", null)
      .eq("inventories.status", "completed")
      .limit(5000),
    supabase.from("production_items").select("production_id, ingredient_id, quantity").limit(5000),
  ]);

  const ingredients = (ing.data ?? []) as HistIngredient[];
  const stockMv = (mv.data ?? []) as StockMovementRow[];
  const purchases = (pur.data ?? []) as PurchaseRow[];
  const invItems = (inv.data ?? []) as unknown as InventoryItemRow[];
  const prodItems = (pi.data ?? []) as ProductionItemRow[];

  const ingMap = new Map(ingredients.map((i) => [i.id, i]));

  // Cost of each production = sum of consumed ingredients
  const productionCost = new Map<string, number>();
  for (const it of prodItems) {
    const cost = Number(ingMap.get(it.ingredient_id)?.avg_cost ?? 0) * Number(it.quantity);
    productionCost.set(it.production_id, (productionCost.get(it.production_id) ?? 0) + cost);
  }

  const moves: UnifiedMove[] = [];

  for (const p of purchases) {
    moves.push({
      key: `purchase-${p.id}`,
      source: "purchase",
      ingredient_id: p.ingredient_id,
      type: "in",
      quantity: Number(p.quantity),
      reason: p.supplier ? `Compra · ${p.supplier}` : "Compra",
      occurred_at: p.purchased_at,
      value: Number(p.quantity) * Number(p.unit_cost ?? 0),
    });
  }

  for (const m of stockMv) {
    const isProduction = (m.notes ?? "").startsWith("production:");
    const prodId = isProduction ? (m.notes ?? "").slice("production:".length) : null;
    let value: number;
    if (isProduction && m.type === "in" && prodId && productionCost.has(prodId)) {
      value = productionCost.get(prodId) ?? 0;
    } else if (m.unit_cost != null) {
      value = Number(m.quantity) * Number(m.unit_cost);
    } else {
      value = Number(m.quantity) * Number(ingMap.get(m.ingredient_id)?.avg_cost ?? 0);
    }
    moves.push({
      key: `manual-${m.id}`,
      source: isProduction ? "production" : "manual",
      ingredient_id: m.ingredient_id,
      type: m.type,
      quantity: Number(m.quantity),
      reason: isProduction ? "Produção" : (m.reason ?? "Manual"),
      occurred_at: m.occurred_at,
      value,
    });
  }

  for (const it of invItems) {
    const delta = Number(it.counted_qty ?? 0) - Number(it.expected_qty ?? 0);
    if (delta === 0) continue;
    moves.push({
      key: `inv-${it.id}`,
      source: "inventory",
      ingredient_id: it.ingredient_id,
      type: delta > 0 ? "in" : "out",
      quantity: Math.abs(delta),
      reason: `Inventário${it.inventories?.name ? ` · ${it.inventories.name}` : ""}`,
      occurred_at: it.inventories?.completed_at ?? new Date().toISOString(),
      value: Math.abs(delta) * Number(ingMap.get(it.ingredient_id)?.avg_cost ?? 0),
    });
  }

  moves.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
  return { ingredients, moves };
}

/**
 * Rebuild stock per ingredient at a given cutoff by reverting every movement
 * that happened after it.
 */
export function stockAt(
  ingredients: HistIngredient[],
  moves: UnifiedMove[],
  cutoff: Date,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const i of ingredients) map.set(i.id, Number(i.current_stock ?? 0));
  for (const m of moves) {
    if (new Date(m.occurred_at) <= cutoff) continue;
    const delta = m.type === "in" ? m.quantity : -m.quantity;
    map.set(m.ingredient_id, (map.get(m.ingredient_id) ?? 0) - delta);
  }
  return map;
}
