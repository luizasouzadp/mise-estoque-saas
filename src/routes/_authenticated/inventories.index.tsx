import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Plus, ClipboardList, Trash2, FolderTree, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { useMemo, useState } from "react";

export const Route = createFileRoute("/_authenticated/inventories/")({ component: InventoriesList });

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function freqLabel(f: string, w: number | null) {
  if (f === "daily") return "Diária";
  if (f === "monthly") return "Mensal";
  return `Semanal${w != null ? ` (${WEEKDAYS[w]})` : ""}`;
}

function statusInfo(frequency: string, last: string | null) {
  if (!last) return { label: "Aguardando 1ª contagem", tone: "new" as const };
  const days = (Date.now() - new Date(last).getTime()) / (1000 * 60 * 60 * 24);
  const limit = frequency === "daily" ? 1 : frequency === "monthly" ? 30 : 7;
  return days > limit
    ? { label: `Atrasado (${Math.floor(days)}d)`, tone: "late" as const }
    : { label: "Em dia", tone: "ok" as const };
}

function InventoriesList() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [bulkOpen, setBulkOpen] = useState(false);


  const { data, isLoading } = useQuery({
    queryKey: ["inventories"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("inventories")
        .select("id, name, frequency, weekday, last_completed_at, created_at")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  async function remove(id: string, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm("Excluir este inventário?")) return;
    const { error } = await supabase.from("inventories").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Excluído");
    qc.invalidateQueries({ queryKey: ["inventories"] });
  }

  return (
    <div className="mx-auto max-w-5xl p-4 md:p-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <ClipboardList className="h-6 w-6 text-primary" />
          <div>
            <h1 className="font-display text-3xl">Inventários</h1>
            <p className="text-sm text-muted-foreground">Cada inventário tem um link único de contagem.</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setBulkOpen(true)}><RefreshCw className="mr-2 h-4 w-4" /> Atualizar estoque</Button>
          <Button variant="outline" onClick={() => nav({ to: "/groups" })}><FolderTree className="mr-2 h-4 w-4" /> Gerenciar grupos</Button>
          <Button onClick={() => nav({ to: "/inventories/new" })}><Plus className="mr-2 h-4 w-4" /> Novo</Button>
        </div>
      </div>

      <BulkStockDialog open={bulkOpen} onOpenChange={setBulkOpen} />


      <div className="mt-6 space-y-3">
        {isLoading ? <p className="text-sm text-muted-foreground">Carregando...</p> :
          (data ?? []).length === 0 ? (
            <div className="rounded-xl border-2 border-dashed bg-card/50 p-12 text-center">
              <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground" />
              <h3 className="mt-4 font-semibold">Nenhum inventário ainda</h3>
              <p className="mt-1 text-sm text-muted-foreground">Crie um inventário para gerar o link de contagem.</p>
            </div>
          ) : (
            (data ?? []).map((inv) => {
              const st = statusInfo(inv.frequency, inv.last_completed_at);
              return (
                <Link key={inv.id} to="/inventories/$id" params={{ id: inv.id }}
                  className="block rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)] hover:border-primary">
                  <div className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="font-semibold truncate">{inv.name ?? "Inventário"}</div>
                      <div className="text-xs text-muted-foreground">
                        {freqLabel(inv.frequency, inv.weekday)}
                        {inv.last_completed_at && <> · última em {new Date(inv.last_completed_at).toLocaleDateString("pt-BR")}</>}
                      </div>
                    </div>
                    <span className={`rounded-full px-3 py-1 text-xs font-medium ${
                      st.tone === "ok" ? "bg-primary/15 text-primary" :
                      st.tone === "late" ? "bg-destructive/15 text-destructive" :
                      "bg-[color:var(--color-warning)]/15 text-[color:var(--color-warning)]"
                    }`}>{st.label}</span>
                    <Button variant="ghost" size="icon" onClick={(e) => remove(inv.id, e)} className="text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Link>
              );
            })
          )}
      </div>
    </div>
  );
}

function BulkStockDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { data: ingredients, isLoading } = useQuery({
    queryKey: ["ingredients", "bulk-stock"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ingredients")
        .select("id, name, unit, current_stock")
        .order("name");
      if (error) throw error;
      return data ?? [];
    },
    enabled: open,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ingredients ?? [];
    return (ingredients ?? []).filter((i) => i.name.toLowerCase().includes(q));
  }, [ingredients, search]);

  async function save() {
    if (!ingredients) return;
    const movements: any[] = [];
    for (const ing of ingredients) {
      const raw = values[ing.id];
      if (raw === undefined || raw === "") continue;
      const newQty = Number(String(raw).replace(",", "."));
      if (!Number.isFinite(newQty)) continue;
      const diff = newQty - Number(ing.current_stock ?? 0);
      if (diff === 0) continue;
      movements.push({
        ingredient_id: ing.id,
        type: diff > 0 ? "in" : "out",
        quantity: Math.abs(diff),
        reason: "Atualização de inventário",
        occurred_at: new Date().toISOString(),
      });
    }
    if (movements.length === 0) {
      toast.info("Nenhuma quantidade alterada");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("stock_movements").insert(movements);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`Estoque atualizado (${movements.length} ${movements.length === 1 ? "item" : "itens"})`);
    setValues({});
    qc.invalidateQueries({ queryKey: ["ingredients"] });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Atualizar todo o estoque</DialogTitle>
          <DialogDescription>
            Informe a quantidade atual contada para cada insumo. Itens em branco serão ignorados.
            Cada alteração gera uma movimentação de ajuste.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Buscar insumo..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="max-h-[55vh] overflow-y-auto rounded-lg border">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Carregando...</p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Nenhum insumo encontrado.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Insumo</th>
                  <th className="px-3 py-2 font-medium">Unid.</th>
                  <th className="px-3 py-2 font-medium text-right">Atual</th>
                  <th className="px-3 py-2 font-medium text-right">Nova qtd.</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((ing) => (
                  <tr key={ing.id} className="border-t">
                    <td className="px-3 py-2">{ing.name}</td>
                    <td className="px-3 py-2 text-muted-foreground">{ing.unit}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {Number(ing.current_stock ?? 0).toLocaleString("pt-BR")}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="—"
                        value={values[ing.id] ?? ""}
                        onChange={(e) => setValues((v) => ({ ...v, [ing.id]: e.target.value }))}
                        className="h-8 w-28 ml-auto text-right"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar atualização"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
