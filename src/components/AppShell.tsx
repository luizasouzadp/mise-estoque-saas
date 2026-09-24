import { useEffect } from "react";
import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { LayoutDashboard, Package, Receipt, LogOut, ClipboardList, ArrowLeftRight, BookOpen, DollarSign, Flame, Percent, Truck, ShieldCheck, BarChart3 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/Logo";
import { useUserRoles } from "@/hooks/use-roles";
import { usePlatformAdmin } from "@/hooks/use-platform-admin";

const allNavItems = [
  { to: "/dashboard", label: "Início", icon: LayoutDashboard },
  { to: "/ingredients", label: "Insumos", icon: Package },
  { to: "/recipes", label: "Fichas", icon: BookOpen },
  { to: "/pricing", label: "Precificação", icon: DollarSign },
  { to: "/productions", label: "Produção", icon: Flame },
  { to: "/purchases", label: "Compras", icon: Receipt },
  { to: "/suppliers", label: "Fornecedores", icon: Truck },
  { to: "/movements", label: "Mov.", icon: ArrowLeftRight },
  { to: "/inventories", label: "Inventário", icon: ClipboardList },
  { to: "/cmv", label: "CMV", icon: Percent },
  { to: "/menu-analysis", label: "Relatório", icon: BarChart3 },
] as const;

export function AppShell() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const { isChef, isReceiver, loading } = useUserRoles();
  const { isPlatformAdmin } = usePlatformAdmin();

  const navItems = isChef
    ? allNavItems.filter((n) => n.to === "/productions")
    : isReceiver
      ? ([{ to: "/purchases/orders", label: "Encomendas", icon: Truck }] as const)
      : isPlatformAdmin
        ? ([...allNavItems, { to: "/admin", label: "Admin", icon: ShieldCheck }] as const)
        : allNavItems;

  useEffect(() => {
    if (loading) return;
    if (isChef && !pathname.startsWith("/productions")) {
      router.navigate({ to: "/productions" });
    }
    if (isReceiver && !pathname.startsWith("/purchases/orders")) {
      router.navigate({ to: "/purchases/orders" });
    }
  }, [isChef, isReceiver, loading, pathname, router]);


  async function logout() {
    await supabase.auth.signOut();
    router.navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden border-r border-white/10 bg-ink text-ink-foreground md:flex md:w-64 md:flex-col">
        <div className="flex h-16 items-center gap-2.5 border-b border-white/10 px-6">
          <Logo tone="dark" size={34} />
          <span className="text-xs text-ink-foreground/60">estoque</span>
        </div>
        <nav className="flex-1 space-y-0.5 p-3">
          {navItems.map((it) => {
            const active = pathname.startsWith(it.to);
            return (
              <Link
                key={it.to}
                to={it.to}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-white/10 text-ink-foreground shadow-[inset_2px_0_0_var(--color-tape)]" : "text-ink-foreground/65 hover:bg-white/5 hover:text-ink-foreground",
                )}
              >
                <it.icon className="h-4 w-4" />
                {it.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 p-3">
          <Button variant="ghost" className="w-full justify-start text-ink-foreground/70 hover:bg-white/10 hover:text-ink-foreground" onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="flex h-14 items-center justify-between bg-ink px-4 text-ink-foreground md:hidden">
        <Logo tone="dark" size={28} />
        <Button variant="ghost" size="icon" className="hover:bg-white/10 hover:text-ink-foreground" onClick={logout} aria-label="Sair">
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      {/* Main */}
      <main className="flex-1 pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className={cn("fixed inset-x-0 bottom-0 z-50 grid border-t bg-card md:hidden", `grid-cols-${navItems.length}`)} style={{ gridTemplateColumns: `repeat(${navItems.length}, minmax(0, 1fr))` }}>
        {navItems.map((it) => {
          const active = pathname.startsWith(it.to);
          return (
            <Link
              key={it.to}
              to={it.to}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                active ? "text-primary font-semibold" : "text-muted-foreground",
              )}
            >
              <it.icon className="h-4 w-4" />
              <span className="truncate max-w-full px-0.5">{it.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
