import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/AppShell";
import { isChefUser } from "@/lib/roles";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      throw redirect({ to: "/login", search: { redirect: location.href } as never });
    }
    const chef = await isChefUser();
    if (chef && !location.pathname.startsWith("/productions")) {
      throw redirect({ to: "/productions" });
    }
  },
  component: AppShell,
});
