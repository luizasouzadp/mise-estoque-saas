import type { SupabaseClient } from "@supabase/supabase-js";

export type DailyOut = { date: string; qty: number };

/**
 * Returns daily "out" quantities for an ingredient over the last N days.
 * Union of: stock_movements(type=out, reason != 'Inventário') + production_items.
 * Zero-filled for days with no activity.
 */
export async function dailyConsumption(
  supabase: SupabaseClient,
  ingredientId: string,
  days: number,
): Promise<DailyOut[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceIso = since.toISOString();

  const [{ data: mv }, { data: pi }] = await Promise.all([
    supabase
      .from("stock_movements")
      .select("quantity, occurred_at, reason, type")
      .eq("ingredient_id", ingredientId)
      .eq("type", "out")
      .gte("occurred_at", sinceIso),
    supabase
      .from("production_items")
      .select("quantity, productions!inner(produced_at)")
      .eq("ingredient_id", ingredientId)
      .gte("productions.produced_at", sinceIso),
  ]);

  const byDay = new Map<string, number>();
  for (const m of mv ?? []) {
    if (typeof m.reason === "string" && m.reason.toLowerCase().startsWith("inventário")) continue;
    const d = new Date(m.occurred_at as string).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + Number(m.quantity ?? 0));
  }
  for (const p of pi ?? []) {
    const producedAt = (p as unknown as { productions: { produced_at: string } }).productions
      ?.produced_at;
    if (!producedAt) continue;
    const d = new Date(producedAt).toISOString().slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + Number(p.quantity ?? 0));
  }

  const series: DailyOut[] = [];
  const cursor = new Date(since);
  const today = new Date();
  while (cursor <= today) {
    const key = cursor.toISOString().slice(0, 10);
    series.push({ date: key, qty: byDay.get(key) ?? 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}

export function totalOut(series: DailyOut[]): number {
  return series.reduce((a, d) => a + d.qty, 0);
}
