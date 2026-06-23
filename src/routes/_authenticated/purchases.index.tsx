import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Receipt, Pencil, Trash2, Search, X } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/purchases/")({
  component: PurchasesList,
});

type PurchaseRow = {
  id: string;
  ingredient_id: string;
  quantity: number;
  unit_cost: number;
  total_cost: number;
  supplier: string | null;
  purchased_at: string;
  ingredient: { name: string; unit: string } | null;
};

function PurchasesList() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["purchases"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchases")
        .select("id, ingredient_id, quantity, unit_cost, total_cost, supplier, purchased_at, ingredient:ingredients(name, unit)")
        .order("purchased_at", { ascending: false });
      if (error) throw error;
      return data as unknown as PurchaseRow[];
    },
  });

  const [ingredientFilter, setIngredientFilter] = useState<string>("all");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const ingredients = useMemo(() => {
    const map = new Map<string, string>();
    data?.forEach((p) => {
      if (p.ingredient_id && p.ingredient?.name && !map.has(p.ingredient_id)) {
        map.set(p.ingredient_id, p.ingredient.name);
      }
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const suppliers = useMemo(() => {
    const set = new Set<string>();
    data?.forEach((p) => {
      if (p.supplier) set.add(p.supplier);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.filter((p) => {
      if (ingredientFilter !== "all" && p.ingredient_id !== ingredientFilter) return false;
      if (supplierFilter && !(p.supplier ?? "").toLowerCase().includes(supplierFilter.toLowerCase())) return false;
      const date = new Date(p.purchased_at);
      if (dateFrom) {
        const from = new Date(dateFrom + "T00:00:00");
        if (date < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo + "T23:59:59.999");
        if (date > to) return false;
      }
      return true;
    });
  }, [data, ingredientFilter, supplierFilter, dateFrom, dateTo]);

  const totalFiltered = useMemo(
    () => filtered.reduce((sum, p) => sum + Number(p.total_cost || 0), 0),
    [filtered]
  );

  function clearFilters() {
    setIngredientFilter("all");
    setSupplierFilter("");
    setDateFrom("");
    setDateTo("");
  }

  const hasFilter = ingredientFilter !== "all" || supplierFilter || dateFrom || dateTo;

  const [edit, setEdit] = useState<PurchaseRow | null>(null);
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [supplier, setSupplier] = useState("");
  const [purchasedAt, setPurchasedAt] = useState("");
  const [saving, setSaving] = useState(false);

  function openEdit(p: PurchaseRow) {
    setEdit(p);
    setQty(String(p.quantity));
    setUnitCost(String(p.unit_cost));
    setSupplier(p.supplier ?? "");
    setPurchasedAt(new Date(p.purchased_at).toISOString().slice(0, 16));
  }

  async function saveEdit() {
    if (!edit) return;
    const q = Number(qty);
    const uc = Number(unitCost);
    if (!Number.isFinite(q) || q <= 0) return toast.error("Quantidade inválida");
    if (!Number.isFinite(uc) || uc < 0) return toast.error("Preço inválido");
    setSaving(true);
    const { error } = await supabase
      .from("purchases")
      .update({
        quantity: q,
        unit_cost: uc,
        total_cost: q * uc,
        supplier: supplier.trim() || null,
        purchased_at: new Date(purchasedAt).toISOString(),
      })
      .eq("id", edit.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Compra atualizada");
    setEdit(null);
    qc.invalidateQueries({ queryKey: ["purchases"] });
    qc.invalidateQueries({ queryKey: ["ingredients"] });
  }

  async function removePurchase(p: PurchaseRow) {
    if (!confirm("Excluir esta compra? O estoque será ajustado.")) return;
    const { error } = await supabase.from("purchases").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Compra excluída");
    qc.invalidateQueries({ queryKey: ["purchases"] });
    qc.invalidateQueries({ queryKey: ["ingredients"] });
  }

  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-3xl">Compras</h1>
          <p className="text-sm text-muted-foreground">Histórico de entradas de insumos.</p>
        </div>
        <Button asChild>
          <Link to="/purchases/new"><Plus className="mr-2 h-4 w-4" /> Nova compra</Link>
        </Button>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : !data || data.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed bg-card/50 p-12 text-center">
            <Receipt className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-4 font-semibold">Nenhuma compra registrada</h3>
            <p className="mt-1 text-sm text-muted-foreground">Registre sua primeira entrada para abastecer o estoque.</p>
            <Button asChild className="mt-4"><Link to="/purchases/new"><Plus className="mr-2 h-4 w-4" /> Nova compra</Link></Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border bg-card shadow-[var(--shadow-soft)]">
            <table className="w-full text-sm">
              <thead className="bg-muted text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="p-3">Data</th>
                  <th className="p-3">Insumo</th>
                  <th className="p-3">Qtd</th>
                  <th className="p-3 hidden sm:table-cell">Preço un.</th>
                  <th className="p-3">Total</th>
                  <th className="p-3 hidden md:table-cell">Fornecedor</th>
                  <th className="p-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.map((p) => (
                  <tr key={p.id}>
                    <td className="p-3 text-muted-foreground">{new Date(p.purchased_at).toLocaleDateString("pt-BR")}</td>
                    <td className="p-3 font-medium">{p.ingredient?.name ?? "—"}</td>
                    <td className="p-3">{Number(p.quantity).toFixed(2)} {p.ingredient?.unit}</td>
                    <td className="p-3 hidden sm:table-cell">R$ {Number(p.unit_cost).toFixed(2)}</td>
                    <td className="p-3 font-semibold">R$ {Number(p.total_cost).toFixed(2)}</td>
                    <td className="p-3 hidden md:table-cell text-muted-foreground">{p.supplier ?? "—"}</td>
                    <td className="p-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(p)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => removePurchase(p)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar compra — {edit?.ingredient?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-2">
              <Label>Data</Label>
              <Input type="datetime-local" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-2">
                <Label>Quantidade ({edit?.ingredient?.unit})</Label>
                <Input type="number" step="0.001" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="grid gap-2">
                <Label>Preço unitário (R$)</Label>
                <Input type="number" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label>Fornecedor</Label>
              <Input value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Total: R$ {((Number(qty) || 0) * (Number(unitCost) || 0)).toFixed(2)}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
