import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { restrictedRoleOf } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login", search: { next: location.href } });
    }
    const role = await restrictedRoleOf();
    if (role === "chef" && !location.pathname.startsWith("/productions")) {
      throw redirect({ to: "/productions" });
    }
    if (role === "receiver" && !location.pathname.startsWith("/purchases/orders")) {
      throw redirect({ to: "/purchases/orders" });
    }
  },
  component: AppShell,
});
