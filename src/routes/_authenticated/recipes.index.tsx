import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, BookOpen, Copy } from "lucide-react";
import { duplicateRecipe } from "@/lib/recipes.functions";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/recipes/")({
  component: RecipesList,
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function RecipesList() {
  const [q, setQ] = useState("");
  const qc = useQueryClient();
  const nav = useNavigate();
  const dup = useServerFn(duplicateRecipe);
  const { data, isLoading } = useQuery({
    queryKey: ["recipes"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, yield_qty, yield_unit, description")
        .order("name");
      if (error) throw error;

      // Fetch cost for each recipe via RPC
      const withCost = await Promise.all(
        (data ?? []).map(async (r) => {
          const { data: total } = await supabase.rpc("recipe_total_cost", { _recipe_id: r.id, _depth: 0 });
          const { data: unit } = await supabase.rpc("recipe_unit_cost", { _recipe_id: r.id });
          return { ...r, total_cost: Number(total ?? 0), unit_cost: Number(unit ?? 0) };
        }),
      );
      return withCost;
    },
  });

  const filtered = (data ?? []).filter((r) => !q || r.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl">Fichas Técnicas</h1>
          <p className="text-sm text-muted-foreground">Receitas, custos e composições.</p>
        </div>
        <Button asChild>
          <Link to="/recipes/new"><Plus className="mr-2 h-4 w-4" /> Nova ficha</Link>
        </Button>
      </div>

      <div className="mt-6 relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar por nome..." className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed bg-card p-10 text-center">
            <BookOpen className="mx-auto h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">Nenhuma ficha técnica ainda.</p>
            <Button asChild className="mt-4"><Link to="/recipes/new"><Plus className="mr-2 h-4 w-4" /> Criar primeira ficha</Link></Button>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((r) => (
              <div
                key={r.id}
                className="group relative rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)] transition hover:border-primary"
              >
                <Link to="/recipes/$id" params={{ id: r.id }} className="block">
                  <h3 className="font-semibold group-hover:text-primary">{r.name}</h3>
                  {r.description && <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{r.description}</p>}
                  <div className="mt-4 flex items-end justify-between text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Rendimento</p>
                      <p className="font-medium">{Number(r.yield_qty)} {r.yield_unit}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Custo / {r.yield_unit}</p>
                      <p className="font-semibold text-primary">{BRL.format(r.unit_cost)}</p>
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-muted-foreground">Total da receita: {BRL.format(r.total_cost)}</div>
                </Link>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    try {
                      const res = await dup({ data: { recipeId: r.id } });
                      toast.success("Ficha duplicada!");
                      qc.invalidateQueries({ queryKey: ["recipes"] });
                      qc.invalidateQueries({ queryKey: ["ingredients"] });
                      nav({ to: "/recipes/$id", params: { id: res.id } });
                    } catch (err: any) {
                      toast.error(err?.message || "Erro ao duplicar");
                    }
                  }}
                  className="absolute right-3 top-3 rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-foreground group-hover:opacity-100"
                  title="Duplicar ficha"
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
