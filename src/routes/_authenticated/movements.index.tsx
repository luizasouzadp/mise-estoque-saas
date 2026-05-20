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
import { ArrowDownCircle, ArrowUpCircle, Pencil, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/movements/")({
  component: MovementsPage,
});

type Ingredient = { id: string; name: string; unit: string; category: string | null };
type Movement = {
  id: string;
  ingredient_id: string;
  type: "in" | "out";
  quantity: number;
  unit_cost: number | null;
  reason: string | null;
  notes: string | null;
  occurred_at: string;
};

function MovementsPage() {
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);

  // filters
  const [fIngredient, setFIngredient] = useState<string>("all");
  const [fCategory, setFCategory] = useState<string>("all");
  const [fType, setFType] = useState<string>("all");
  const [fFrom, setFFrom] = useState<string>("");
  const [fTo, setFTo] = useState<string>("");

  // dialog
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Movement | null>(null);
  const [form, setForm] = useState({
    ingredient_id: "",
    type: "in" as "in" | "out",
    quantity: "",
    unit_cost: "",
    reason: "",
    notes: "",
    occurred_at: new Date().toISOString().slice(0, 16),
  });

  async function load() {
    setLoading(true);
    const [ing, mv] = await Promise.all([
      supabase.from("ingredients").select("id, name, unit, category").order("name"),
      supabase.from("stock_movements").select("*").order("occurred_at", { ascending: false }).limit(1000),
    ]);
    setIngredients((ing.data ?? []) as Ingredient[]);
    setMovements((mv.data ?? []) as Movement[]);
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

  const filtered = useMemo(() => {
    return movements.filter((m) => {
      if (fIngredient !== "all" && m.ingredient_id !== fIngredient) return false;
      if (fType !== "all" && m.type !== fType) return false;
      if (fCategory !== "all") {
        const ing = ingMap.get(m.ingredient_id);
        if (ing?.category !== fCategory) return false;
      }
      if (fFrom && m.occurred_at < new Date(fFrom).toISOString()) return false;
      if (fTo) {
        const to = new Date(fTo);
        to.setHours(23, 59, 59, 999);
        if (m.occurred_at > to.toISOString()) return false;
      }
      return true;
    });
  }, [movements, fIngredient, fType, fCategory, fFrom, fTo, ingMap]);

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

  function openEdit(m: Movement) {
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

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl">Movimentações</h1>
          <p className="text-sm text-muted-foreground">Histórico de entradas e saídas de estoque</p>
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
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 rounded-lg border bg-card p-3">
        <div>
          <Label className="text-xs">Insumo</Label>
          <Select value={fIngredient} onValueChange={setFIngredient}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              {ingredients.map((i) => <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Categoria</Label>
          <Select value={fCategory} onValueChange={setFCategory}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {categories.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">Tipo</Label>
          <Select value={fType} onValueChange={setFType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos</SelectItem>
              <SelectItem value="in">Entrada</SelectItem>
              <SelectItem value="out">Saída</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs">De</Label>
          <Input type="date" value={fFrom} onChange={(e) => setFFrom(e.target.value)} />
        </div>
        <div>
          <Label className="text-xs">Até</Label>
          <Input type="date" value={fTo} onChange={(e) => setFTo(e.target.value)} />
        </div>
      </div>

      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Insumo</TableHead>
              <TableHead className="text-right">Qtd</TableHead>
              <TableHead>Motivo</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Sem movimentações</TableCell></TableRow>
            )}
            {filtered.map((m) => {
              const ing = ingMap.get(m.ingredient_id);
              return (
                <TableRow key={m.id}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {new Date(m.occurred_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                  <TableCell>
                    {m.type === "in" ? (
                      <Badge variant="secondary" className="gap-1"><ArrowDownCircle className="h-3 w-3 text-green-600" />Entrada</Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1"><ArrowUpCircle className="h-3 w-3 text-red-600" />Saída</Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{ing?.name ?? "—"}</div>
                    {ing?.category && <div className="text-xs text-muted-foreground">{ing.category}</div>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {Number(m.quantity).toLocaleString("pt-BR")} {ing?.unit}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{m.reason ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex gap-1 justify-end">
                      <Button size="icon" variant="ghost" onClick={() => openEdit(m)}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => remove(m.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
