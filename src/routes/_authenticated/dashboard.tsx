import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Package, AlertTriangle, Receipt, Plus, PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UserSettings } from "@/components/UserSettings";


export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function formatBRL(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [ing, purch] = await Promise.all([
        supabase.from("ingredients").select("id, name, current_stock, min_stock, unit, avg_cost, is_active"),
        supabase.from("purchases").select("id, total_cost, purchased_at").order("purchased_at", { ascending: false }).limit(5),
      ]);
      if (ing.error) throw ing.error;
      if (purch.error) throw purch.error;
      const items = (ing.data ?? []).filter((i) => i.is_active !== false);
      const lowStock = items.filter((i) => Number(i.current_stock) > 0 && Number(i.min_stock) > 0 && Number(i.current_stock) <= Number(i.min_stock));
      const outOfStock = items.filter((i) => Number(i.current_stock) <= 0);
      const stockValue = items.reduce((s, i) => s + Number(i.current_stock) * Number(i.avg_cost), 0);
      return { ingredients: items, purchases: purch.data ?? [], lowStock, outOfStock, stockValue };
    },
  });

  const alerts = [...(data?.outOfStock ?? []), ...(data?.lowStock ?? [])];

  return (
    <div>
      <div className="bg-hero text-hero-foreground">
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 md:px-8 md:pb-20 md:pt-8">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="font-display text-2xl md:text-3xl">Painel</h1>
              <p className="text-sm text-hero-foreground/70">Resumo da sua operação.</p>
            </div>
            <Button asChild className="hidden bg-white text-[oklch(0.25_0.06_262)] hover:bg-white/90 md:inline-flex">
              <Link to="/purchases/new"><Plus className="mr-2 h-4 w-4" /> Nova compra</Link>
            </Button>
          </div>
          <div className="mt-6">
            <p className="text-sm text-hero-foreground/70">Valor em estoque</p>
            <div className="mt-1 font-display text-3xl font-bold tracking-tight md:text-4xl">
              {isLoading ? "—" : formatBRL(data?.stockValue ?? 0)}
            </div>
            <div className="mt-3 h-0.5 w-10 bg-tape" />
          </div>
        </div>
      </div>

      <div className="mx-auto -mt-10 max-w-6xl px-4 pb-8 md:px-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Package} label="Insumos cadastrados" value={isLoading ? "—" : String(data?.ingredients.length ?? 0)} accent="primary" />
        <StatCard icon={AlertTriangle} label="Estoque baixo" value={isLoading ? "—" : String(data?.lowStock.length ?? 0)} accent="warning" />
        <StatCard icon={PackageX} label="Sem estoque" value={isLoading ? "—" : String(data?.outOfStock.length ?? 0)} accent="danger" />
      </div>

      {alerts.length > 0 && (
        <div className="mt-8 rounded-xl border bg-card p-5 shadow-[var(--shadow-soft)]">
          <h2 className="text-lg font-semibold flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-[color:var(--color-warning)]" /> Atenção ao estoque</h2>
          <ul className="mt-3 divide-y">
            {alerts.map((i) => {
              const out = Number(i.current_stock) <= 0;
              return (
                <li key={i.id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-2">
                    <span>{i.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${out ? "bg-destructive/10 text-destructive" : "bg-warning/15 text-warning-foreground"}`}>
                      {out ? "sem estoque" : "baixo"}
                    </span>
                  </div>
                  <span className="text-sm text-muted-foreground">
                    {Number(i.current_stock).toFixed(2)} {i.unit} (mín {Number(i.min_stock).toFixed(2)})
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <QuickCard title="Cadastrar insumo" desc="Adicione um item ao catálogo." to="/ingredients/new" />
        <QuickCard title="Registrar compra" desc="Atualize estoque e custo médio." to="/purchases/new" />
      </div>

      <div className="mt-8">
        <UserSettings />
      </div>
      </div>
    </div>
  );
}


function StatCard({ icon: Icon, label, value, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; accent: "primary" | "warning" | "accent" | "danger" }) {
  // Só o número muda de cor quando pede atenção; o resto do cartão fica neutro
  const tone =
    accent === "warning" ? "text-warning"
    : accent === "danger" ? "text-destructive"
    : "text-foreground";
  return (
    <div className="rounded-lg border bg-card p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-sm">{label}</span>
        <Icon className="h-4 w-4" />
      </div>
      <div className={`mt-3 font-display text-3xl font-bold leading-none tracking-tight ${tone}`}>{value}</div>
    </div>
  );
}


function QuickCard({ title, desc, to }: { title: string; desc: string; to: "/ingredients/new" | "/purchases/new" }) {
  return (
    <Link to={to} className="group rounded-xl border bg-card p-5 shadow-[var(--shadow-soft)] transition hover:border-primary hover:shadow-[var(--shadow-card)]">
      <h3 className="font-semibold group-hover:text-primary">{title}</h3>
      <p className="mt-1 text-sm text-muted-foreground">{desc}</p>
    </Link>
  );
}
