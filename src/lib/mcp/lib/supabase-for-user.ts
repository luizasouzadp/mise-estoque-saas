import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ToolContext } from "@lovable.dev/mcp-js";

export function supabaseForUser(ctx: ToolContext): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function getRestaurantId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("restaurant_id")
    .eq("id", userId)
    .maybeSingle();
  return data?.restaurant_id ?? null;
}

export function notAuthed() {
  return { content: [{ type: "text" as const, text: "Não autenticado" }], isError: true };
}

export function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

// Arredonda números para 3 casas e transforma -0 em 0, recursivamente.
// Evita resíduos de ponto flutuante como 18.849000000000007 ou -0.000006.
export function cleanNumbers<T>(value: T): T {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return value;
    const rounded = Math.round(value * 1000) / 1000;
    return (rounded === 0 ? 0 : rounded) as T;
  }
  if (Array.isArray(value)) return value.map(cleanNumbers) as T;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, cleanNumbers(v)]),
    ) as T;
  }
  return value;
}

export function ok<T>(structured: T, summary?: string) {
  const clean = cleanNumbers(structured);
  return {
    content: [{ type: "text" as const, text: summary ?? JSON.stringify(clean, null, 2) }],
    structuredContent: clean as Record<string, unknown>,
  };
}
