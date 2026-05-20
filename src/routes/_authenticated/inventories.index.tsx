import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Plus, ClipboardList } from "lucide-react";

export const Route = createFileRoute("/_authenticated/inventories/")({ component: InventoriesList });

function InventoriesList() {
  const { data, isLoading } = useQuery({
    queryKey: ["inventories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventories")
        .select("id, status, scheduled_for, created_at, completed_at, group_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      const { data: groups } = await supabase.from("ingredient_groups").select("id, name");
      const gmap = new Map((groups ?? []).map((g) => [g.id, g.name]));
      return (data ?? []).map((i) => ({ ...i, groupName: i.group_id ? gmap.get(i.group_id) : null }));
    },
  });

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-primary" />
          <div>
            <h1 className="font-display text-3xl">Inventários</h1>
            <p className="text-sm text-muted-foreground">Contagens semanais por grupo de insumos.</p>
          </div>
        </div>
        <Button asChild><Link to="/inventories/new"><Plus className="mr-2 h-4 w-4" /> Novo inventário</Link></Button>
      </div>

      <div className="mt-6 space-y-3">
        {isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> :
          (data ?? []).length === 0 ? (
            <div className="rounded-xl border-2 border-dashed bg-card/50 p-12 text-center">
              <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground" />
              <h3 className="mt-4 font-semibold">Nenhum inventário ainda</h3>
              <p className="mt-1 text-sm text-muted-foreground">Crie um inventário para gerar o link de contagem.</p>
            </div>
          ) : (
            (data ?? []).map((inv) => (
              <Link key={inv.id} to="/inventories/$id" params={{ id: inv.id }}
                className="block rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)] hover:border-primary">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="font-semibold">{inv.groupName ?? "Todos os insumos"}</div>
                    <div className="text-xs text-muted-foreground">
                      Criado em {new Date(inv.created_at).toLocaleDateString("pt-BR")}
                      {inv.completed_at && <> · finalizado em {new Date(inv.completed_at).toLocaleDateString("pt-BR")}</>}
                    </div>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                    inv.status === "completed" ? "bg-primary/15 text-primary" :
                    inv.status === "cancelled" ? "bg-muted text-muted-foreground" :
                    "bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]"
                  }`}>
                    {inv.status === "completed" ? "Finalizado" : inv.status === "cancelled" ? "Cancelado" : "Em aberto"}
                  </span>
                </div>
              </Link>
            ))
          )}
      </div>
    </div>
  );
}
