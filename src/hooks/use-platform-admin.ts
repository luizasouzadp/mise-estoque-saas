import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function usePlatformAdmin() {
  const [isPlatformAdmin, setIsPlatformAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) {
        if (active) setIsPlatformAdmin(false);
        return;
      }
      const { data } = await supabase
        .from("profiles")
        .select("is_platform_admin")
        .eq("id", u.user.id)
        .maybeSingle();
      if (active) setIsPlatformAdmin(!!data?.is_platform_admin);
    })();
    return () => {
      active = false;
    };
  }, []);

  return { isPlatformAdmin, loading: isPlatformAdmin === null };
}
