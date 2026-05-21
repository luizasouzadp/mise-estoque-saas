import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowDownCircle, ArrowUpCircle, Filter, Pencil, Plus, Sparkles, ShoppingCart, ClipboardCheck, Flame, Trash2, X } from "lucide-react";

export const Route = createFileRoute("/_authenticated/movements/")({
  component: MovementsPage,
});

type Ingredient = { id: string; name: string; unit: string; category: string | null; created_at: string; avg_cost: number };
type StockMovement = {
  id: string;
  ingredient_id: string;
  type: "in" | "out";
  quantity: number;
  unit_cost: number | null;
  reason: string | null;
  notes: string | null;
  occurred_at: string;
};
type Purchase = {
  id: string;
  ingredient_id: string;
  quantity: number;
  unit_cost: number;
  supplier: string | null;
  purchased_at: string;
};
type InventoryItemRow = {
  id: string;
  ingredient_id: string;
  counted_qty: number | null;
  expected_qty: number;
  inventory_id: string;
  inventories: { name: string | null; completed_at: string | null; status: string } | null;
};
type ProductionItem = { production_id: string; ingredient_id: string; quantity: number };

type Source = "manual" | "purchase" | "inventory" | "created" | "production";
type UnifiedMovement = {
  key: string;
  source: Source;
  ingredient_id: string;
  type: "in" | "out" | "info";
  quantity: number;
  reason: string;
  occurred_at: string;
  value: number | null;
  manual: StockMovement | null;
  purchase: Purchase | null;
  invItem: InventoryItemRow | null;
};

const emptyFilters = {
  ingredient: "all",
  category: "all",
  type: "all",
  source: "all",
  from: "",
  to: "",
};

function MovementsPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [stockMv, setStockMv] = useState<StockMovement[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [invItems, setInvItems] = useState<InventoryItemRow[]>([]);
  const [prodItems, setProdItems] = useState<ProductionItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [draft, setDraft] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<StockMovement | null>(null);
  const [form, setForm] = useState({
    ingredient_id: "",
    type: "in" as "in" | "out",
    quantity: "",
    unit_cost: "",
    reason: "",
    notes: "",
    occurred_at: new Date().toISOString().slice(0, 16),
  });

  const [quick, setQuick] = useState<UnifiedMovement | null>(null);
  const [quickQty, setQuickQty] = useState("");

  async function load() {
    setLoading(true);
    const [ing, mv, pur, inv, pi] = await Promise.all([
      supabase.from("ingredients").select("id, name, unit, category, created_at, avg_cost").order("name"),
      supabase.from("stock_movements").select("*").order("occurred_at", { ascending: false }).limit(1000),
      supabase.from("purchases").select("id, ingredient_id, quantity, unit_cost, supplier, purchased_at").order("purchased_at", { ascending: false }).limit(1000),
      supabase
        .from("inventory_items")
        .select("id, ingredient_id, counted_qty, expected_qty, inventory_id, inventories!inner(name, completed_at, status)")
        .not("counted_qty", "is", null)
        .eq("inventories.status", "completed")
        .limit(2000),
      supabase.from("production_items").select("production_id, ingredient_id, quantity"),
    ]);
    setIngredients((ing.data ?? []) as Ingredient[]);
    setStockMv((mv.data ?? []) as StockMovement[]);
    setPurchases((pur.data ?? []) as Purchase[]);
    setInvItems((inv.data ?? []) as unknown as InventoryItemRow[]);
    setProdItems((pi.data ?? []) as ProductionItem[]);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const ingMap = useMemo(() => new Map(ingredients.map((i) => [i.id, i])), [ingredients]);
  const categories = useMemo(
    () => Array.from(new Set(ingredients.map((i) => i.category).filter(Boolean))) as string[],
    [ingredients],
  );

  // Production cost map: production_id -> total cost (sum of consumed items × avg_cost)
  const productionCost = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of prodItems) {
      const ing = ingredients.find((x) => x.id === it.ingredient_id);
      const cost = Number(ing?.avg_cost ?? 0) * Number(it.quantity);
      m.set(it.production_id, (m.get(it.production_id) ?? 0) + cost);
    }
    return m;
  }, [prodItems, ingredients]);

  const unified = useMemo<UnifiedMovement[]>(() => {
    const list: UnifiedMovement[] = [];

    for (const i of ingredients) {
      list.push({
        key: `created-${i.id}`,
        source: "created",
        ingredient_id: i.id,
        type: "info",
        quantity: 0,
        reason: "Insumo cadastrado",
        occurred_at: i.created_at,
        value: null,
        manual: null, purchase: null, invItem: null,
      });
    }
    for (const p of purchases) {
      list.push({
        key: `purchase-${p.id}`,
        source: "purchase",
        ingredient_id: p.ingredient_id,
        type: "in",
        quantity: Number(p.quantity),
        reason: p.supplier ? `Compra · ${p.supplier}` : "Compra",
        occurred_at: p.purchased_at,
        value: Number(p.quantity) * Number(p.unit_cost ?? 0),
        manual: null, purchase: p, invItem: null,
      });
    }
    for (const m of stockMv) {
      const ing = ingMap.get(m.ingredient_id);
      const isProduction = (m.notes ?? "").startsWith("production:");
      const prodId = isProduction ? (m.notes ?? "").slice("production:".length) : null;
      let value: number;
      if (isProduction && m.type === "in" && prodId && productionCost.has(prodId)) {
        // Pré-preparo produzido: valor = soma dos insumos consumidos
        value = productionCost.get(prodId) ?? 0;
      } else if (m.unit_cost != null) {
        value = Number(m.quantity) * Number(m.unit_cost);
      } else {
        value = Number(m.quantity) * Number(ing?.avg_cost ?? 0);
      }
      list.push({
        key: `manual-${m.id}`,
        source: isProduction ? "production" : "manual",
        ingredient_id: m.ingredient_id,
        type: m.type,
        quantity: Number(m.quantity),
        reason: isProduction ? "Produção" : (m.reason ?? "Manual"),
        occurred_at: m.occurred_at,
        value,
        manual: m, purchase: null, invItem: null,
      });
    }
    for (const it of invItems) {
      const delta = Number(it.counted_qty ?? 0) - Number(it.expected_qty ?? 0);
      if (delta === 0) continue;
      const ing = ingMap.get(it.ingredient_id);
      list.push({
        key: `inv-${it.id}`,
        source: "inventory",
        ingredient_id: it.ingredient_id,
        type: delta > 0 ? "in" : "out",
        quantity: Math.abs(delta),
        reason: `Inventário${it.inventories?.name ? ` · ${it.inventories.name}` : ""}`,
        occurred_at: it.inventories?.completed_at ?? new Date().toISOString(),
        value: Math.abs(delta) * Number(ing?.avg_cost ?? 0),
        manual: null, purchase: null, invItem: it,
      });
    }

    return list.sort((a, b) => (a.occurred_at < b.occurred_at ? 1 : -1));
  }, [ingredients, purchases, stockMv, invItems, ingMap, productionCost]);

  const filtered = useMemo(() => {
    return unified.filter((m) => {
      if (applied.ingredient !== "all" && m.ingredient_id !== applied.ingredient) return false;
      if (applied.type !== "all" && m.type !== applied.type) return false;
      if (applied.source !== "all" && m.source !== applied.source) return false;
      if (applied.category !== "all") {
        const ing = ingMap.get(m.ingredient_id);
        if (ing?.category !== applied.category) return false;
      }
      if (applied.from && m.occurred_at < new Date(applied.from).toISOString()) return false;
      if (applied.to) {
        const to = new Date(applied.to);
        to.setHours(23, 59, 59, 999);
        if (m.occurred_at > to.toISOString()) return false;
      }
      return true;
    });
  }, [unified, applied, ingMap]);

  const hasActiveFilters = useMemo(
    () => JSON.stringify(applied) !== JSON.stringify(emptyFilters),
    [applied],
  );

  function applyFilters() {
    setApplied(draft);
  }
  function clearFilters() {
    setDraft(emptyFilters);
    setApplied(emptyFilters);
  }

  function openNew() {
    setEditing(null);
    setForm({
      ingredient_id: "",
      type: "in",
      quantity: "",
      unit_cost: "",
      reason: "",
      notes: "",
      occurred_at: new Date().toISOString().slice(0, 16),
    });
    setOpen(true);
  }

  function openEdit(m: StockMovement) {
    setEditing(m);
    setForm({
      ingredient_id: m.ingredient_id,
      type: m.type,
      quantity: String(m.quantity),
      unit_cost: m.unit_cost != null ? String(m.unit_cost) : "",
      reason: m.reason ?? "",
      notes: m.notes ?? "",
      occurred_at: new Date(m.occurred_at).toISOString().slice(0, 16),
    });
    setOpen(true);
  }

  async function save() {
    if (!form.ingredient_id) return toast.error("Selecione um insumo");
    const qty = Number(form.quantity);
    if (!qty || qty <= 0) return toast.error("Quantidade inválida");

    const { data: prof } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!prof?.restaurant_id) return toast.error("Restaurante não encontrado");

    const payload = {
      restaurant_id: prof.restaurant_id,
      ingredient_id: form.ingredient_id,
      type: form.type,
      quantity: qty,
      unit_cost: form.unit_cost ? Number(form.unit_cost) : null,
      reason: form.reason || null,
      notes: form.notes || null,
      occurred_at: new Date(form.occurred_at).toISOString(),
    };

    const { error } = editing
      ? await supabase.from("stock_movements").update(payload).eq("id", editing.id)
      : await supabase.from("stock_movements").insert(payload);
    if (error) return toast.error(error.message);
    toast.success(editing ? "Movimentação atualizada" : "Movimentação registrada");
    setOpen(false);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Excluir esta movimentação? O estoque será revertido.")) return;
    const { error } = await supabase.from("stock_movements").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Movimentação excluída");
    load();
  }

  function isEditable(m: UnifiedMovement) {
    return m.source !== "created";
  }
  function openQuick(m: UnifiedMovement) {
    if (!isEditable(m)) return;
    setQuick(m);
    setQuickQty(String(m.quantity));
  }
  async function quickSave() {
    if (!quick) return;
    const qty = Number(quickQty);
    if (!Number.isFinite(qty) || qty <= 0) return toast.error("Quantidade inválida");

    if (quick.manual) {
      const { error } = await supabase
        .from("stock_movements")
        .update({ quantity: qty })
        .eq("id", quick.manual.id);
      if (error) return toast.error(error.message);
    } else if (quick.purchase) {
      const unit = Number(quick.purchase.unit_cost) || 0;
      const { error } = await supabase
        .from("purchases")
        .update({ quantity: qty, total_cost: qty * unit })
        .eq("id", quick.purchase.id);
      if (error) return toast.error(error.message);
    } else if (quick.invItem) {
      // Preserve the direction of the delta (in/out) chosen at count time
      const sign = quick.type === "in" ? 1 : -1;
      const newCounted = Number(quick.invItem.expected_qty) + sign * qty;
      const { error } = await supabase
        .from("inventory_items")
        .update({ counted_qty: newCounted })
        .eq("id", quick.invItem.id);
      if (error) return toast.error(error.message);
    }
    toast.success("Movimentação atualizada");
    setQuick(null);
    load();
  }
  async function quickDelete() {
    if (!quick) return;
    if (!confirm("Excluir esta movimentação? O estoque será ajustado.")) return;

    if (quick.manual) {
      const { error } = await supabase.from("stock_movements").delete().eq("id", quick.manual.id);
      if (error) return toast.error(error.message);
    } else if (quick.purchase) {
      const { error } = await supabase.from("purchases").delete().eq("id", quick.purchase.id);
      if (error) return toast.error(error.message);
    } else if (quick.invItem) {
      // Zerar a contagem (volta a expected, sem delta)
      const { error } = await supabase
        .from("inventory_items")
        .update({ counted_qty: Number(quick.invItem.expected_qty) })
        .eq("id", quick.invItem.id);
      if (error) return toast.error(error.message);
    }
    toast.success("Movimentação excluída");
    setQuick(null);
    load();
  }

  function sourceBadge(s: Source) {
    if (s === "created") return <Badge variant="outline" className="gap-1"><Sparkles className="h-3 w-3" />Cadastro</Badge>;
    if (s === "purchase") return <Badge variant="outline" className="gap-1"><ShoppingCart className="h-3 w-3" />Compra</Badge>;
    if (s === "inventory") return <Badge variant="outline" className="gap-1"><ClipboardCheck className="h-3 w-3" />Inventário</Badge>;
    if (s === "production") return <Badge variant="outline" className="gap-1"><Flame className="h-3 w-3" />Produção</Badge>;
    return <Badge variant="outline" className="gap-1"><Pencil className="h-3 w-3" />Manual</Badge>;
  }

  function formatBRL(n: number | null) {
    if (n == null) return "—";
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl">Movimentações</h1>
          <p className="text-sm text-muted-foreground">Histórico completo: cadastros, compras, inventários e ajustes manuais</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}>
              <Plus className="h-4 w-4" /> Nova
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? "Editar movimentação" : "Nova movimentação"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              <div>
                <Label>Tipo</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as "in" | "out" })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">Entrada</SelectItem>
                    <SelectItem value="out">Saída</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Insumo</Label>
                <Select value={form.ingredient_id} onValueChange={(v) => setForm({ ...form, ingredient_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                  <SelectContent>
                    {ingredients.map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Quantidade</Label>
                  <Input type="number" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
                </div>
                <div>
                  <Label>Custo unitário (opcional)</Label>
                  <Input type="number" step="0.01" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Data/hora</Label>
                <Input type="datetime-local" value={form.occurred_at} onChange={(e) => setForm({ ...form, occurred_at: e.target.value })} />
              </div>
              <div>
                <Label>Motivo</Label>
                <Input placeholder="Compra, perda, ajuste..." value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
              </div>
              <div>
                <Label>Observação</Label>
                <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save}>{editing ? "Salvar" : "Registrar"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filtros */}
      <div className="rounded-lg border bg-card p-3 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <div>
            <Label className="text-xs">Insumo</Label>
            <Select value={draft.ingredient} onValueChange={(v) => setDraft({ ...draft, ingredient: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {ingredients.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Categoria</Label>
            <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Origem</Label>
            <Select value={draft.source} onValueChange={(v) => setDraft({ ...draft, source: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="created">Cadastro</SelectItem>
                <SelectItem value="purchase">Compra</SelectItem>
                <SelectItem value="inventory">Inventário</SelectItem>
                <SelectItem value="manual">Manual</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Tipo</Label>
            <Select value={draft.type} onValueChange={(v) => setDraft({ ...draft, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="in">Entrada</SelectItem>
                <SelectItem value="out">Saída</SelectItem>
                <SelectItem value="info">Informativo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4" /> Limpar
            </Button>
          )}
          <Button size="sm" onClick={applyFilters}>
            <Filter className="h-4 w-4" /> Filtrar
          </Button>
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Origem</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Insumo</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Sem movimentações</TableCell></TableRow>
            )}
            {filtered.map((m) => {
              const ing = ingMap.get(m.ingredient_id);
              const editable = isEditable(m);
              return (
                <TableRow
                  key={m.key}
                  className={editable ? "cursor-pointer hover:bg-muted/40" : ""}
                  onClick={() => editable && openQuick(m)}
                >
                  <TableCell className="whitespace-nowrap text-xs">
                    {new Date(m.occurred_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                  <TableCell>{sourceBadge(m.source)}</TableCell>
                  <TableCell>
                    {m.type === "in" ? (
                      <Badge variant="secondary" className="gap-1"><ArrowDownCircle className="h-3 w-3 text-green-600" />Entrada</Badge>
                    ) : m.type === "out" ? (
                      <Badge variant="secondary" className="gap-1"><ArrowUpCircle className="h-3 w-3 text-red-600" />Saída</Badge>
                    ) : (
                      <Badge variant="secondary">—</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{ing?.name ?? "—"}</div>
                    {ing?.category && <div className="text-xs text-muted-foreground">{ing.category}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {m.type === "info" ? "—" : `${Number(m.quantity).toLocaleString("pt-BR")} ${ing?.unit ?? ""}`}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.reason}</TableCell>
                  <TableCell>
                    {editable && (
                      <div className="flex justify-end text-muted-foreground">
                        <Pencil className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!quick} onOpenChange={(o) => !o && setQuick(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar movimentação</DialogTitle>
          </DialogHeader>
          {quick && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {sourceBadge(quick.source)} <span className="ml-2">{ingMap.get(quick.ingredient_id)?.name}</span>
              </div>
              <div>
                <Label>Quantidade ({ingMap.get(quick.ingredient_id)?.unit ?? ""})</Label>
                <Input
                  type="number"
                  step="0.001"
                  value={quickQty}
                  onChange={(e) => setQuickQty(e.target.value)}
                />
              </div>
              {quick.source === "inventory" && (
                <p className="text-xs text-muted-foreground">
                  A contagem do inventário será ajustada mantendo a direção ({quick.type === "in" ? "entrada" : "saída"}).
                </p>
              )}
            </div>
          )}
          <DialogFooter className="flex !justify-between sm:!justify-between">
            <Button variant="destructive" onClick={quickDelete}>
              <Trash2 className="h-4 w-4" /> Excluir
            </Button>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setQuick(null)}>Cancelar</Button>
              <Button onClick={quickSave}>Salvar</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
