import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pricing/")({
  component: PricingPage,
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type MenuProduct = {
  id: string;
  name: string;
  category: string | null;
  current_price: number | null;
  cost: number;
  items: { name: string; quantity?: string }[];
};

type Row = {
  id: string;
  name: string;
  menu_category: string | null;
  current_price: number | null;
  yield_qty: number;
  yield_unit: string;
  unit_cost: number;
};

function PricingPage() {
  const qc = useQueryClient();

  const { data: restaurant } = useQuery({
    queryKey: ["restaurant-pricing"],
    queryFn: async () => {
      const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
      if (!profile?.restaurant_id) return null;
      const { data, error } = await supabase.from("restaurants").select("id, ideal_cmv").eq("id", profile.restaurant_id).single();
      if (error) throw error;
      return data;
    },
  });

  const [idealCmvDraft, setIdealCmvDraft] = useState<string>("");
  const idealCmv = idealCmvDraft !== "" ? Number(idealCmvDraft) : Number(restaurant?.ideal_cmv ?? 30);

  async function saveIdealCmv() {
    if (!restaurant) return;
    const v = Number(idealCmvDraft);
    if (!(v > 0 && v < 100)) return toast.error("Informe um percentual entre 0 e 100");
    const { error } = await supabase.from("restaurants").update({ ideal_cmv: v }).eq("id", restaurant.id);
    if (error) return toast.error(error.message);
    toast.success("CMV ideal atualizado");
    setIdealCmvDraft("");
    qc.invalidateQueries({ queryKey: ["restaurant-pricing"] });
  }

  const { data: rows } = useQuery<Row[]>({
    queryKey: ["pricing-rows"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, menu_category, current_price, yield_qty, yield_unit")
        .eq("is_on_menu", true)
        .order("name");
      if (error) throw error;
      const enriched = await Promise.all(
        (data ?? []).map(async (r) => {
          const { data: uc } = await supabase.rpc("recipe_unit_cost", { _recipe_id: r.id });
          return { ...r, unit_cost: Number(uc ?? 0) } as Row;
        }),
      );
      return enriched;
    },
  });

  const [filter, setFilter] = useState<"all" | "above" | "below">("all");
  const [search, setSearch] = useState("");

  const enrichedRows = useMemo(() => {
    return (rows ?? []).map((r) => {
      const idealPrice = idealCmv > 0 ? r.unit_cost / (idealCmv / 100) : 0;
      const currentCmv = r.current_price && r.current_price > 0 ? (r.unit_cost / r.current_price) * 100 : null;
      return { ...r, idealPrice, currentCmv };
    });
  }, [rows, idealCmv]);

  const filtered = useMemo(() => {
    return enrichedRows.filter((r) => {
      if (search && !r.name.toLowerCase().includes(search.toLowerCase()) && !(r.menu_category ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "above") return r.currentCmv != null && r.currentCmv > idealCmv;
      if (filter === "below") return r.currentCmv != null && r.currentCmv <= idealCmv;
      return true;
    });
  }, [enrichedRows, filter, search, idealCmv]);

  async function updateField(id: string, patch: Partial<Pick<Row, "current_price" | "menu_category">>) {
    const { error } = await supabase.from("recipes").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["pricing-rows"] });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div>
        <h1 className="font-display text-3xl">Precificação</h1>
        <p className="text-sm text-muted-foreground">Defina seu CMV ideal e acompanhe a saúde dos preços do seu cardápio.</p>
      </div>

      {/* CMV ideal */}
      <div className="rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
        <Label htmlFor="ideal">CMV ideal (%)</Label>
        <p className="text-xs text-muted-foreground mb-2">Percentual alvo do custo sobre o preço de venda.</p>
        <div className="flex items-center gap-2">
          <Input
            id="ideal"
            type="number"
            step="0.1"
            min="0"
            max="100"
            className="max-w-[160px]"
            placeholder={String(restaurant?.ideal_cmv ?? 30)}
            value={idealCmvDraft}
            onChange={(e) => setIdealCmvDraft(e.target.value)}
          />
          <span className="text-sm text-muted-foreground">Atual: {Number(restaurant?.ideal_cmv ?? 30)}%</span>
          <Button onClick={saveIdealCmv} disabled={idealCmvDraft === ""}>Salvar</Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
        <div className="flex-1 min-w-[200px]">
          <Label>Buscar</Label>
          <Input placeholder="Nome ou categoria..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="min-w-[180px]">
          <Label>Filtrar por CMV</Label>
          <Select value={filter} onValueChange={(v: "all" | "above" | "below") => setFilter(v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="above">Acima do ideal</SelectItem>
              <SelectItem value="below">No/abaixo do ideal</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl border bg-card shadow-[var(--shadow-soft)]">
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nenhum item no cardápio. Edite uma <Link to="/recipes" className="text-primary hover:underline">ficha técnica</Link> e marque "Faz parte do cardápio?" como Sim.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Preço ideal</TableHead>
                <TableHead className="text-right">Preço atual</TableHead>
                <TableHead className="text-right">CMV atual</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((r) => {
                const above = r.currentCmv != null && r.currentCmv > idealCmv;
                const below = r.currentCmv != null && r.currentCmv <= idealCmv;
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <Link to="/recipes/$id" params={{ id: r.id }} className="font-medium hover:text-primary">{r.name}</Link>
                      <div className="text-xs text-muted-foreground">por {r.yield_unit}</div>
                    </TableCell>
                    <TableCell>
                      <Input
                        defaultValue={r.menu_category ?? ""}
                        placeholder="—"
                        className="h-8"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v !== (r.menu_category ?? "")) updateField(r.id, { menu_category: v || null });
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right">{BRL.format(r.unit_cost)}</TableCell>
                    <TableCell className="text-right">{BRL.format(r.idealPrice)}</TableCell>
                    <TableCell className="text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        defaultValue={r.current_price ?? ""}
                        placeholder="—"
                        className="h-8 w-28 ml-auto text-right"
                        onBlur={(e) => {
                          const v = e.target.value === "" ? null : Number(e.target.value);
                          if (v !== r.current_price) updateField(r.id, { current_price: v });
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.currentCmv == null ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <Badge
                          variant="outline"
                          className={
                            above
                              ? "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400"
                              : below
                                ? "border-green-500/40 bg-green-500/10 text-green-600 dark:text-green-400"
                                : ""
                          }
                        >
                          {r.currentCmv.toFixed(1)}%
                        </Badge>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
