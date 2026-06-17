import { supabase } from "@/integrations/supabase/client";

export async function isChefUser(): Promise<boolean | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userData.user.id);
  const roles = (data ?? []).map((r) => r.role);
  return roles.length === 1 && roles[0] === "chef";
}
