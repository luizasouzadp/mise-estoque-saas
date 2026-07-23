import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
// supplier picker uses existing Select component
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/searchable-select";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Paperclip, FileText, X } from "lucide-react";


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
  const [purchasedAt, setPurchasedAt] = useState(() => {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0, 10);
  });
  const [saving, setSaving] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);


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

    // Upload attachments (photos or PDF) to purchase-invoices bucket.
    const uploadedPaths: string[] = [];
    try {
      for (const f of attachments) {
        const ext = (f.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        const path = `${profile.restaurant_id}/${crypto.randomUUID()}.${ext || "jpg"}`;
        const { error: upErr } = await supabase.storage
          .from("purchase-invoices")
          .upload(path, f, { contentType: f.type || "application/octet-stream", upsert: false });
        if (upErr) throw new Error(`Falha no upload: ${upErr.message}`);
        uploadedPaths.push(path);
      }
    } catch (err) {
      setSaving(false);
      return toast.error((err as Error).message);
    }

    const now = new Date();
    const time = now.toTimeString().slice(0, 8);
    const datePart = purchasedAt || now.toISOString().slice(0, 10);
    const purchasedAtWithTime = new Date(`${datePart}T${time}`).toISOString();
    const firstPath = uploadedPaths[0] ?? null;
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
        invoice_image_path: firstPath,
        invoice_image_paths: uploadedPaths.length ? uploadedPaths : null,
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
    qc.invalidateQueries({ queryKey: ["purchase-notes"] });
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
                      <Input type="number" step="0.001" min="0" value={it.quantity} onChange={(e) => updateItem(it.id, { quantity: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-xs">Preço unitário (R$)</Label>
                      <Input type="number" step="0.001" min="0" value={it.unitCost} onChange={(e) => updateItem(it.id, { unitCost: e.target.value })} />
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

          <div className="space-y-2 rounded-lg border bg-background/50 p-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-2"><Paperclip className="h-4 w-4" /> Anexos da nota (fotos ou PDF)</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                <Plus className="mr-1 h-4 w-4" /> Adicionar
              </Button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={(e) => {
                const list = Array.from(e.target.files ?? []);
                if (!list.length) return;
                setAttachments((prev) => [...prev, ...list]);
                if (fileInputRef.current) fileInputRef.current.value = "";
              }}
            />
            {attachments.length === 0 ? (
              <p className="text-xs text-muted-foreground">Opcional. Adicione várias páginas se a nota tiver mais de uma folha.</p>
            ) : (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {attachments.map((f, i) => {
                  const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
                  const url = !isPdf ? URL.createObjectURL(f) : null;
                  return (
                    <div key={i} className="relative rounded-md border bg-card p-2">
                      {isPdf ? (
                        <div className="flex h-24 items-center justify-center gap-2 text-muted-foreground">
                          <FileText className="h-6 w-6" />
                          <span className="text-xs truncate max-w-[10rem]">{f.name}</span>
                        </div>
                      ) : (
                        <img src={url!} alt={f.name} className="h-24 w-full rounded object-cover" />
                      )}
                      <button
                        type="button"
                        aria-label="Remover anexo"
                        className="absolute -top-2 -right-2 rounded-full bg-background border p-1 text-muted-foreground hover:text-destructive"
                        onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
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
