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

export function ok<T>(structured: T, summary?: string) {
  return {
    content: [{ type: "text" as const, text: summary ?? JSON.stringify(structured, null, 2) }],
    structuredContent: structured as Record<string, unknown>,
  };
}
