import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Package } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ingredients/")({
  component: IngredientsList,
});

function IngredientsList() {
  const [q, setQ] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["ingredients"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingredients")
        .select("id, name, unit, category, current_stock, avg_cost, min_stock")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const filtered = (data ?? []).filter((i) =>
    !q || i.name.toLowerCase().includes(q.toLowerCase()) || (i.category ?? "").toLowerCase().includes(q.toLowerCase()),
  );

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Insumos</h1>
          <p className="text-sm text-muted-foreground">Catálogo do seu restaurante.</p>
        </div>
        <Button asChild>
          <Link to="/ingredients/new"><Plus className="mr-2 h-4 w-4" /> Novo insumo</Link>
        </Button>
      </div>

      <div className="mt-6 relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar por nome ou categoria..." className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((i) => {
              const low = Number(i.min_stock) > 0 && Number(i.current_stock) <= Number(i.min_stock);
              return (
                <Link
                  key={i.id}
                  to="/ingredients/$id"
                  params={{ id: i.id }}
                  className="group rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)] transition hover:border-primary"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold group-hover:text-primary">{i.name}</h3>
                      {i.category && <p className="text-xs text-muted-foreground">{i.category}</p>}
                    </div>
                    {low && (
                      <span className="rounded-full bg-[color:var(--color-warning)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--color-warning)]">baixo</span>
                    )}
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <div className="font-display text-2xl">{Number(i.current_stock).toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">{i.unit}</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>R$ {Number(i.avg_cost).toFixed(2)}</div>
                      <div>custo médio</div>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border-2 border-dashed bg-card/50 p-12 text-center">
      <Package className="mx-auto h-10 w-10 text-muted-foreground" />
      <h3 className="mt-4 font-semibold">Nenhum insumo ainda</h3>
      <p className="mt-1 text-sm text-muted-foreground">Comece cadastrando seu primeiro item.</p>
      <Button asChild className="mt-4">
        <Link to="/ingredients/new"><Plus className="mr-2 h-4 w-4" /> Novo insumo</Link>
      </Button>
    </div>
  );
}
