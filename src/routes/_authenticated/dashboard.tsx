import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Package, AlertTriangle, Receipt, Plus, Wallet, PackageX } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
});

function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      const [ing, purch] = await Promise.all([
        supabase.from("ingredients").select("id, name, current_stock, min_stock, unit, avg_cost"),
        supabase.from("purchases").select("id, total_cost, purchased_at").order("purchased_at", { ascending: false }).limit(5),
      ]);
      if (ing.error) throw ing.error;
      if (purch.error) throw purch.error;
      const items = ing.data ?? [];
      const lowStock = items.filter((i) => Number(i.current_stock) > 0 && Number(i.min_stock) > 0 && Number(i.current_stock) <= Number(i.min_stock));
      const outOfStock = items.filter((i) => Number(i.current_stock) <= 0);
      const stockValue = items.reduce((s, i) => s + Number(i.current_stock) * Number(i.avg_cost), 0);
      return { ingredients: items, purchases: purch.data ?? [], lowStock, outOfStock, stockValue };
    },
  });

  const alerts = [...(data?.outOfStock ?? []), ...(data?.lowStock ?? [])];

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Olá, chef 👋</h1>
          <p className="text-sm text-muted-foreground">Resumo da sua operação.</p>
        </div>
        <Button asChild className="hidden md:inline-flex">
          <Link to="/purchases/new"><Plus className="mr-2 h-4 w-4" /> Nova compra</Link>
        </Button>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Package} label="Insumos cadastrados" value={isLoading ? "—" : String(data?.ingredients.length ?? 0)} accent="primary" />
        <StatCard icon={Wallet} label="Valor em estoque" value={isLoading ? "—" : `R$ ${(data?.stockValue ?? 0).toFixed(2)}`} accent="accent" />
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
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${out ? "bg-destructive/15 text-destructive" : "bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]"}`}>
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
    </div>
  );
}


function StatCard({ icon: Icon, label, value, accent }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; accent: "primary" | "warning" | "accent" | "danger" }) {
  const bg =
    accent === "primary" ? "bg-primary/10 text-primary"
    : accent === "warning" ? "bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]"
    : accent === "danger" ? "bg-destructive/15 text-destructive"
    : "bg-accent/15 text-accent";
  return (
    <div className="rounded-xl border bg-card p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${bg}`}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="mt-3 font-display text-3xl">{value}</div>
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
