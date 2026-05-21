import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { ChefHat, LayoutDashboard, Package, Receipt, LogOut, ClipboardList, FolderTree, ArrowLeftRight, BookOpen, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const navItems = [
  { to: "/dashboard", label: "Início", icon: LayoutDashboard },
  { to: "/ingredients", label: "Insumos", icon: Package },
  { to: "/recipes", label: "Fichas", icon: BookOpen },
  { to: "/pricing", label: "Preços", icon: DollarSign },
  { to: "/groups", label: "Grupos", icon: FolderTree },
  { to: "/purchases", label: "Compras", icon: Receipt },
  { to: "/movements", label: "Mov.", icon: ArrowLeftRight },
  { to: "/inventories", label: "Inventário", icon: ClipboardList },
] as const;

export function AppShell() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  async function logout() {
    await supabase.auth.signOut();
    router.navigate({ to: "/login" });
  }

  return (
    <div className="flex min-h-screen flex-col bg-background md:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden border-r bg-card md:flex md:w-64 md:flex-col">
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ChefHat className="h-4 w-4" />
          </div>
          <span className="font-display text-lg">Mise</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((it) => {
            const active = pathname.startsWith(it.to);
            return (
              <Link
                key={it.to}
                to={it.to}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-secondary-foreground",
                )}
              >
                <it.icon className="h-4 w-4" />
                {it.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t p-3">
          <Button variant="ghost" className="w-full justify-start" onClick={logout}>
            <LogOut className="mr-2 h-4 w-4" /> Sair
          </Button>
        </div>
      </aside>

      {/* Mobile header */}
      <header className="flex h-14 items-center justify-between border-b bg-card px-4 md:hidden">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ChefHat className="h-4 w-4" />
          </div>
          <span className="font-display text-lg">Mise</span>
        </div>
        <Button variant="ghost" size="icon" onClick={logout} aria-label="Sair">
          <LogOut className="h-4 w-4" />
        </Button>
      </header>

      {/* Main */}
      <main className="flex-1 pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-8 border-t bg-card md:hidden">
        {navItems.map((it) => {
          const active = pathname.startsWith(it.to);
          return (
            <Link
              key={it.to}
              to={it.to}
              className={cn(
                "flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium",
                active ? "text-primary" : "text-muted-foreground",
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
