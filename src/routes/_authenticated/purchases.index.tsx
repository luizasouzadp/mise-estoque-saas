import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
} from "@/components/ui/searchable-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Plus, Receipt, Pencil, Trash2, Search, X, Camera, Images, ShoppingCart, PackageCheck, FileWarning, ArrowRight, ImageOff } from "lucide-react";
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
  const nav = useNavigate();
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

  // Pending receipt notes waiting to become purchase entries.
  const { data: pending } = useQuery({
    queryKey: ["purchase-orders-pending-import"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("purchase_orders")
        .select("id, supplier_name, receipt_image_path, receipt_notes, received_at")
        .eq("import_status", "pending")
        .not("receipt_image_path", "is", null)
        .order("received_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        supplier_name: string | null;
        receipt_image_path: string;
        receipt_notes: string | null;
        received_at: string | null;
      }>;
    },
  });

  const { data: looseInvoices } = useQuery({
    queryKey: ["pending-invoices"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("pending_invoices")
        .select("id, supplier_name, notes, image_paths, created_at")
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Array<{
        id: string;
        supplier_name: string | null;
        notes: string | null;
        image_paths: string[];
        created_at: string;
      }>;
    },
  });

  const pendingGroups = useMemo(() => {
    if (!pending && !looseInvoices) return [] as Array<{
      path: string; supplier: string | null; notes: string | null; received_at: string | null; count: number; ids: string[]; pendingId: string | null;
    }>;
    const map = new Map<string, { path: string; supplier: string | null; notes: string | null; received_at: string | null; count: number; ids: string[] }>();
    for (const p of pending) {
      const g = map.get(p.receipt_image_path);
      if (g) {
        g.count += 1;
        g.ids.push(p.id);
        if (!g.notes && p.receipt_notes) g.notes = p.receipt_notes;
      } else {
        map.set(p.receipt_image_path, {
          path: p.receipt_image_path,
          supplier: p.supplier_name,
          notes: p.receipt_notes,
          received_at: p.received_at,
          count: 1,
          ids: [p.id],
        });
      }
    }
    const out = Array.from(map.values()).map((g) => ({ ...g, pendingId: null as string | null }));
    for (const li of looseInvoices ?? []) {
      const path = li.image_paths?.[0];
      if (!path) continue;
      out.push({
        path,
        supplier: li.supplier_name,
        notes: li.notes,
        received_at: li.created_at,
        count: li.image_paths.length,
        ids: [li.id],
        pendingId: li.id,
      });
    }
    return out;
  }, [pending, looseInvoices]);

  const [pendingUrls, setPendingUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const missing = pendingGroups.map((g) => g.path).filter((p) => !pendingUrls[p]);
    if (missing.length === 0) return;
    (async () => {
      const { data: signed } = await supabase.storage
        .from("purchase-invoices")
        .createSignedUrls(missing, 60 * 60);
      if (!signed) return;
      setPendingUrls((prev) => {
        const next = { ...prev };
        signed.forEach((s, i) => {
          if (s.signedUrl) next[missing[i]] = s.signedUrl;
        });
        return next;
      });
    })();
  }, [pendingGroups, pendingUrls]);

  async function skipPending(ids: string[], pendingId: string | null) {
    if (!confirm("Ignorar esta pendência? A nota permanecerá arquivada, mas nenhuma entrada será cobrada.")) return;
    if (pendingId) {
      const { error } = await (supabase as any)
        .from("pending_invoices")
        .update({ status: "skipped" })
        .eq("id", pendingId);
      if (error) return toast.error(error.message);
      qc.invalidateQueries({ queryKey: ["pending-invoices"] });
      return;
    }
    const { error } = await (supabase as any)
      .from("purchase_orders")
      .update({ import_status: "skipped" })
      .in("id", ids);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["purchase-orders-pending-import"] });
  }

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
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link to="/purchases/shopping-list"><ShoppingCart className="mr-2 h-4 w-4" /> Lista de compras</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/purchases/orders"><PackageCheck className="mr-2 h-4 w-4" /> Encomendas</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/purchases/notes"><Images className="mr-2 h-4 w-4" /> Notas</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/purchases/import"><Camera className="mr-2 h-4 w-4" /> Por foto da nota</Link>
          </Button>
          <Button asChild>
            <Link to="/purchases/new"><Plus className="mr-2 h-4 w-4" /> Nova compra</Link>
          </Button>
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {pendingGroups.length > 0 && (
          <div className="rounded-xl border-2 border-amber-400/60 bg-amber-50 p-4 shadow-[var(--shadow-soft)] dark:bg-amber-950/30">
            <div className="mb-3 flex items-center gap-2 text-amber-900 dark:text-amber-200">
              <FileWarning className="h-5 w-5" />
              <h2 className="font-semibold">Notas aguardando entrada</h2>
              <span className="text-xs opacity-70">
                Notas recebidas aguardando entrada dos itens.
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pendingGroups.map((g) => {
                const url = pendingUrls[g.path];
                return (
                  <div key={g.path} className="flex gap-3 rounded-lg border bg-card p-3">
                    <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                      {url ? (
                        <img src={url} alt="Nota" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <ImageOff className="h-5 w-5" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{g.supplier ?? "Sem fornecedor"}</p>
                      <p className="text-xs text-muted-foreground">
                        {g.received_at ? new Date(g.received_at).toLocaleDateString("pt-BR") : "—"} · {g.count} item(ns)
                      </p>
                      {g.notes && (
                        <p className="mt-1 line-clamp-2 text-xs text-amber-800 dark:text-amber-200">
                          ⚠ {g.notes}
                        </p>
                      )}
                      <div className="mt-2 flex gap-1">
                        <Button
                          size="sm"
                          onClick={() =>
                            nav({
                              to: "/purchases/import",
                              search: g.pendingId
                                ? { pendingInvoiceId: g.pendingId }
                                : { fromOrderReceipt: g.path },
                            })
                          }
                        >
                          Dar entrada <ArrowRight className="ml-1 h-3 w-3" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => skipPending(g.ids, g.pendingId)}>
                          Ignorar
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}


        <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end">
            <div className="grid gap-2 md:w-56">
              <Label htmlFor="ingredient-filter">Insumo</Label>
              <Select value={ingredientFilter} onValueChange={setIngredientFilter}>
                <SelectTrigger id="ingredient-filter">
                  <SelectValue placeholder="Todos os insumos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os insumos</SelectItem>
                  {ingredients.map(([id, name]) => (
                    <SelectItem key={id} value={id}>{name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2 md:w-56">
              <Label htmlFor="supplier-filter">Fornecedor</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="supplier-filter"
                  list="supplier-options"
                  placeholder="Buscar fornecedor"
                  value={supplierFilter}
                  onChange={(e) => setSupplierFilter(e.target.value)}
                  className="pl-9"
                />
                <datalist id="supplier-options">
                  {suppliers.map((s) => <option key={s} value={s} />)}
                </datalist>
              </div>
            </div>
            <div className="grid gap-2 md:w-44">
              <Label htmlFor="date-from">De</Label>
              <Input id="date-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
            </div>
            <div className="grid gap-2 md:w-44">
              <Label htmlFor="date-to">Até</Label>
              <Input id="date-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
            </div>
            {hasFilter && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="md:mb-0.5">
                <X className="mr-1 h-4 w-4" /> Limpar
              </Button>
            )}
          </div>
          {hasFilter && (
            <div className="mt-4 flex items-center justify-between border-t pt-3 text-sm">
              <span className="text-muted-foreground">{filtered.length} compra(s) encontrada(s)</span>
              <span className="font-semibold">Total filtrado: R$ {totalFiltered.toFixed(2)}</span>
            </div>
          )}
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : !filtered || filtered.length === 0 ? (
          <div className="rounded-xl border-2 border-dashed bg-card/50 p-12 text-center">
            <Receipt className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-4 font-semibold">Nenhuma compra encontrada</h3>
            <p className="mt-1 text-sm text-muted-foreground">Ajuste os filtros ou registre uma nova entrada.</p>
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
                {filtered.map((p) => (
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
              <tfoot className="bg-muted/50 text-sm font-semibold">
                <tr>
                  <td className="p-3 hidden sm:table-cell" colSpan={4}>Total</td>
                  <td className="p-3 sm:hidden" colSpan={4}>Total</td>
                  <td className="p-3">R$ {totalFiltered.toFixed(2)}</td>
                  <td className="p-3 hidden md:table-cell"></td>
                  <td className="p-3"></td>
                </tr>
              </tfoot>
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
