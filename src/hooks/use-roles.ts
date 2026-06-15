import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "owner" | "manager" | "staff" | "chef";

export function useUserRoles() {
  const [roles, setRoles] = useState<AppRole[] | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        if (active) setRoles([]);
        return;
      }
      const { data } = await supabase.from("user_roles").select("role").eq("user_id", u.user.id);
      if (!active) return;
      setRoles(((data ?? []) as { role: AppRole }[]).map((r) => r.role));
    })();
    return () => { active = false; };
  }, []);

  return {
    roles,
    loading: roles === null,
    isChef: roles?.length === 1 && roles[0] === "chef",
    hasRole: (r: AppRole) => !!roles?.includes(r),
  };
}
