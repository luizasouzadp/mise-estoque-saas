import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Search, Package, Upload } from "lucide-react";

export const Route = createFileRoute("/_authenticated/ingredients/")({
  component: IngredientsList,
});

function parseBool(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return ["sim", "s", "yes", "y", "true", "1", "x"].includes(s);
}
function parseNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const s = String(v).replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

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
              const cur = Number(i.current_stock);
              const min = Number(i.min_stock);
              const out = cur <= 0;
              const low = !out && min > 0 && cur <= min;
              const pct = min > 0 ? Math.min(100, (cur / min) * 100) : 100;
              return (
                <Link
                  key={i.id}
                  to="/ingredients/$id"
                  params={{ id: i.id }}
                  className="group rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)] transition hover:border-primary"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold group-hover:text-primary">{i.name}</h3>
                      {i.category && <p className="text-xs text-muted-foreground">{i.category}</p>}
                    </div>
                    {out ? (
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">sem estoque</span>
                    ) : low ? (
                      <span className="rounded-full bg-[color:var(--color-warning)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--color-warning)]">baixo</span>
                    ) : null}
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <div className="font-display text-2xl">{cur.toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">{i.unit} {min > 0 && <>· mín {min.toFixed(2)}</>}</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>R$ {Number(i.avg_cost).toFixed(2)}</div>
                      <div>custo médio</div>
                    </div>
                  </div>
                  {min > 0 && (
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full transition-all ${out ? "bg-destructive" : low ? "bg-[color:var(--color-warning)]" : "bg-primary"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
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
