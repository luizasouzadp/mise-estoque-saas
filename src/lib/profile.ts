import { supabase } from "@/integrations/supabase/client";

/**
 * Returns the current user's restaurant_id, or null.
 * Filters profiles by the caller's own id explicitly: a platform admin can
 * see every profile row via RLS, so an unfiltered `.maybeSingle()` on
 * `profiles` returns an error (multiple rows) instead of their own row.
 */
export async function getMyRestaurantId(): Promise<string | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("restaurant_id")
    .eq("id", userData.user.id)
    .maybeSingle();
  return data?.restaurant_id ?? null;
}
