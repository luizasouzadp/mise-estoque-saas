import type { SupabaseClient } from "@supabase/supabase-js";

export type AccessDecision = "allow" | "block";

export interface AccessContext {
  isPlatformAdmin: boolean;
  restaurantStatus: "ativo" | "bloqueado" | null;
}

/** Pure decision: never allows access unless positively confirmed. */
export function resolveAccessDecision(input: AccessContext): AccessDecision {
  if (input.isPlatformAdmin) return "allow";
  if (input.restaurantStatus === "ativo") return "allow";
  return "block";
}

/** Fail-closed: any error or missing data resolves to a context that blocks access. */
export async function fetchAccessContext(
  supabase: SupabaseClient,
  userId: string,
): Promise<AccessContext> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("is_platform_admin, restaurants(status)")
      .eq("id", userId)
      .single();

    if (error || !data) return { isPlatformAdmin: false, restaurantStatus: null };

    const restauranteBruto = data.restaurants as unknown;
    const restaurante = (Array.isArray(restauranteBruto) ? restauranteBruto[0] : restauranteBruto) as
      | { status: string }
      | null
      | undefined;

    return {
      isPlatformAdmin: !!data.is_platform_admin,
      restaurantStatus: (restaurante?.status as "ativo" | "bloqueado" | undefined) ?? null,
    };
  } catch {
    return { isPlatformAdmin: false, restaurantStatus: null };
  }
}
