/**
 * Busca todas as linhas de uma consulta, página por página.
 * O Supabase devolve no máximo 1000 linhas por pedido; sem isso, o histórico
 * antigo some e o saldo reconstruído para trás fica errado (negativo).
 * `build` recebe o intervalo e deve ter ordenação estável (ex.: data + id).
 */
export async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
  pageSize = 1000,
): Promise<{ data: T[]; error: unknown }> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) return { data: all, error };
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) return { data: all, error: null };
  }
}
