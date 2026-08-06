import { supabase } from "@/integrations/supabase/client";

export type RestrictedRole = "chef" | "receiver";

/** Returns the restricted role of the current user, or null for full access. */
export async function restrictedRoleOf(): Promise<RestrictedRole | null | undefined> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return undefined;
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  const roles = (data ?? []).map((r) => r.role as string);
  if (roles.length === 1 && (roles[0] === "chef" || roles[0] === "receiver")) {
    return roles[0] as RestrictedRole;
  }
  return null;
}

export function homePathForRole(role: RestrictedRole | null | undefined) {
  if (role === "chef") return "/productions" as const;
  if (role === "receiver") return "/purchases/orders" as const;
  return "/dashboard" as const;
}

export async function isChefUser(): Promise<boolean | null> {
  const r = await restrictedRoleOf();
  if (r === undefined) return null;
  return r === "chef";
}
