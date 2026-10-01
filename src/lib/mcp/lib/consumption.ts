import type { SupabaseClient } from "@supabase/supabase-js";

export type DailyOut = { date: string; qty: number };

/**
 * Returns daily "out" quantities for an ingredient over the last N days.
 * Union of: stock_movements(type=out) + production_items.
 * Inclui as saídas geradas pelas contagens ("Inventário · ..."): para quem controla
 * o estoque por contagem, essa diferença é o próprio consumo.
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

const PAGE = 1000;

// Busca todas as linhas de uma consulta em páginas (a API devolve no máximo 1000 por vez).
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * Igual a `dailyConsumption`, mas para todos os insumos do restaurante de uma vez.
 * Faz poucas consultas no total (em vez de 2 por insumo), evitando estourar o
 * limite de requisições por chamada do Cloudflare Worker.
 */
export async function dailyConsumptionAll(
  supabase: SupabaseClient,
  days: number,
): Promise<Map<string, DailyOut[]>> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceIso = since.toISOString();

  type MvRow = { ingredient_id: string; quantity: number; occurred_at: string; reason: string | null };
  type PiRow = { ingredient_id: string; quantity: number; productions: { produced_at: string } | null };

  const [mv, pi] = await Promise.all([
    fetchAll<MvRow>((from, to) =>
      supabase
        .from("stock_movements")
        .select("ingredient_id, quantity, occurred_at, reason")
        .eq("type", "out")
        .gte("occurred_at", sinceIso)
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: MvRow[] | null; error: { message: string } | null }>,
    ),
    fetchAll<PiRow>((from, to) =>
      supabase
        .from("production_items")
        .select("ingredient_id, quantity, productions!inner(produced_at)")
        .gte("productions.produced_at", sinceIso)
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: PiRow[] | null; error: { message: string } | null }>,
    ),
  ]);

  const byIng = new Map<string, Map<string, number>>();
  const add = (ingId: string, day: string, qty: number) => {
    let m = byIng.get(ingId);
    if (!m) byIng.set(ingId, (m = new Map()));
    m.set(day, (m.get(day) ?? 0) + qty);
  };
  for (const m of mv) {
    add(m.ingredient_id, new Date(m.occurred_at).toISOString().slice(0, 10), Number(m.quantity ?? 0));
  }
  for (const p of pi) {
    const producedAt = p.productions?.produced_at;
    if (!producedAt) continue;
    add(p.ingredient_id, new Date(producedAt).toISOString().slice(0, 10), Number(p.quantity ?? 0));
  }

  const dayKeys: string[] = [];
  const cursor = new Date(since);
  const today = new Date();
  while (cursor <= today) {
    dayKeys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const result = new Map<string, DailyOut[]>();
  for (const [ingId, m] of byIng) {
    result.set(ingId, dayKeys.map((date) => ({ date, qty: m.get(date) ?? 0 })));
  }
  return result;
}

/** Série zerada para insumos sem nenhum consumo no período. */
export function emptySeries(days: number): DailyOut[] {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const series: DailyOut[] = [];
  const cursor = new Date(since);
  const today = new Date();
  while (cursor <= today) {
    series.push({ date: cursor.toISOString().slice(0, 10), qty: 0 });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return series;
}
