import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
// supplier picker uses existing Select component
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/searchable-select";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/purchases/new")({
  component: NewPurchase,
});

type Item = { id: string; ingredientId: string; quantity: string; unitCost: string };

const newItem = (): Item => ({
  id: crypto.randomUUID(),
  ingredientId: "",
  quantity: "",
  unitCost: "",
});

function NewPurchase() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: ingredients } = useQuery({
    queryKey: ["ingredients"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ingredients").select("id, name, unit").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: suppliers, refetch: refetchSuppliers } = useQuery({
    queryKey: ["suppliers"],
    queryFn: async () => {
      const { data, error } = await supabase.from("suppliers").select("id, name").order("name");
      if (error) throw error;
      return data;
    },
  });

  const [items, setItems] = useState<Item[]>([newItem()]);
  const [supplier, setSupplier] = useState("");
  const [newSupplierName, setNewSupplierName] = useState("");
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [purchasedAt, setPurchasedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);

  async function addSupplier() {
    const name = newSupplierName.trim();
    if (!name) return;
    const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!profile?.restaurant_id) return toast.error("Sessão inválida.");
    const { data, error } = await supabase
      .from("suppliers")
      .insert({ restaurant_id: profile.restaurant_id, name })
      .select("id, name")
      .single();
    if (error) return toast.error(error.message);
    await refetchSuppliers();
    setSupplier(data.name);
    setNewSupplierName("");
    setAddingSupplier(false);
    toast.success("Fornecedor adicionado.");
  }

  const total = useMemo(
    () => items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitCost) || 0), 0),
    [items],
  );

  function updateItem(id: string, patch: Partial<Item>) {
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  }
  function removeItem(id: string) {
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((it) => it.id !== id)));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const valid = items.filter((it) => it.ingredientId && Number(it.quantity) > 0 && Number(it.unitCost) >= 0);
    if (valid.length === 0) return toast.error("Adicione ao menos um insumo válido.");
    setSaving(true);
    const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    const { data: u } = await supabase.auth.getUser();
    if (!profile?.restaurant_id || !u.user) {
      setSaving(false);
      return toast.error("Sessão inválida.");
    }
    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    const datePart = purchasedAt || now.toISOString().slice(0, 10);
    const purchasedAtWithTime = new Date(`${datePart}T${time}`).toISOString();
    const rows = valid.map((it) => {
      const q = Number(it.quantity);
      const uc = Number(it.unitCost);
      return {
        restaurant_id: profile.restaurant_id,
        ingredient_id: it.ingredientId,
        quantity: q,
        unit_cost: uc,
        total_cost: q * uc,
        supplier: supplier || null,
        purchased_at: purchasedAtWithTime,
        created_by: u.user!.id,
      };
    });
    const { error } = await supabase.from("purchases").insert(rows);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(`${rows.length} ${rows.length === 1 ? "item registrado" : "itens registrados"}! Estoque atualizado.`);
    qc.invalidateQueries({ queryKey: ["purchases"] });
    qc.invalidateQueries({ queryKey: ["ingredients"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    nav({ to: "/purchases" });
  }

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-8">
      <Link to="/purchases" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <h1 className="mt-3 font-display text-3xl">Nova compra</h1>
      <p className="text-sm text-muted-foreground">Adicione vários insumos em uma única compra. Estoque e custo médio são atualizados automaticamente.</p>

      {(!ingredients || ingredients.length === 0) && (
        <div className="mt-6 rounded-xl border bg-card p-6 text-center">
          <p className="text-sm text-muted-foreground">Cadastre um insumo antes de registrar compras.</p>
          <Button asChild className="mt-3"><Link to="/ingredients/new">Cadastrar insumo</Link></Button>
        </div>
      )}

      {ingredients && ingredients.length > 0 && (
        <form onSubmit={onSubmit} className="mt-6 space-y-4 rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Fornecedor (opcional)</Label>
              {!addingSupplier ? (
                <div className="flex gap-2">
                  <Select value={supplier || "__none__"} onValueChange={(v) => setSupplier(v === "__none__" ? "" : v)}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sem fornecedor</SelectItem>
                      {suppliers?.map((s) => <SelectItem key={s.id} value={s.name}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="outline" size="icon" onClick={() => setAddingSupplier(true)} title="Novo fornecedor">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    placeholder="Nome do fornecedor"
                    value={newSupplierName}
                    onChange={(e) => setNewSupplierName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSupplier(); } }}
                  />
                  <Button type="button" size="sm" onClick={addSupplier}>Salvar</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setAddingSupplier(false); setNewSupplierName(""); }}>Cancelar</Button>
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="dt">Data</Label>
              <Input id="dt" type="date" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
            </div>
          </div>

          <div className="space-y-3">
            <Label>Itens</Label>
            {items.map((it, idx) => {
              const selected = ingredients.find((i) => i.id === it.ingredientId);
              const sub = (Number(it.quantity) || 0) * (Number(it.unitCost) || 0);
              return (
                <div key={it.id} className="rounded-lg border bg-background/50 p-3 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Item {idx + 1}</span>
                    {items.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => removeItem(it.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <Select value={it.ingredientId} onValueChange={(v) => updateItem(it.id, { ingredientId: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecione o insumo..." /></SelectTrigger>
                    <SelectContent>
                      {ingredients.map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label className="text-xs">Quantidade {selected ? `(${selected.unit})` : ""}</Label>
                      <Input type="number" step="0.01" min="0" value={it.quantity} onChange={(e) => updateItem(it.id, { quantity: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Preço unitário (R$)</Label>
                      <Input type="number" step="0.01" min="0" value={it.unitCost} onChange={(e) => updateItem(it.id, { unitCost: e.target.value })} />
                    </div>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    Subtotal: <span className="font-medium text-foreground">R$ {sub.toFixed(2)}</span>
                  </div>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={() => setItems((p) => [...p, newItem()])}>
              <Plus className="mr-1 h-4 w-4" /> Adicionar item
            </Button>
          </div>


          <div className="flex items-center justify-between rounded-lg bg-secondary p-4">
            <span className="text-sm text-secondary-foreground">Total da compra</span>
            <span className="font-display text-2xl">R$ {total.toFixed(2)}</span>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => nav({ to: "/purchases" })}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Registrar compra"}</Button>
          </div>
        </form>
      )}
    </div>
  );
}
