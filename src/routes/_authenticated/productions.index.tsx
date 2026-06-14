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
import { toast } from "sonner";
import { ChefHat, Filter, Plus, Trash2, X } from "lucide-react";
import { compatibleUnits, convert } from "@/lib/units";

export const Route = createFileRoute("/_authenticated/productions/")({
  component: ProductionsPage,
});

type Recipe = {
  id: string;
  name: string;
  yield_qty: number;
  yield_unit: string;
  is_stocked: boolean;
};

type Ingredient = { id: string; name: string; unit: string };

type RecipeItem = {
  id: string;
  item_type: string;
  ingredient_id: string | null;
  quantity: number;
  unit: string;
};

type ProductionRow = {
  id: string;
  recipe_id: string;
  quantity_produced: number;
  produced_at: string;
  notes: string | null;
  recipes: { name: string; yield_unit: string } | null;
};

type ProductionItemRow = {
  id: string;
  production_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
};

type DraftItem = {
  ingredient_id: string;
  ingredient_name: string;
  baseUnit: string;
  quantity: string;
  unit: string;
};

type QueuedProduction = {
  key: string;
  recipeId: string;
  recipeName: string;
  yieldUnit: string;
  produced: string;
  producedAt: string;
  notes: string;
  items: DraftItem[];
};

function ProductionsPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [productions, setProductions] = useState<ProductionRow[]>([]);
  const [items, setItems] = useState<ProductionItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  const [filterRecipe, setFilterRecipe] = useState("all");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");

  const [open, setOpen] = useState(false);
  const [recipeId, setRecipeId] = useState("");
  const [produced, setProduced] = useState("");
  const [producedAt, setProducedAt] = useState(new Date().toISOString().slice(0, 16));
  const [notes, setNotes] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [queue, setQueue] = useState<QueuedProduction[]>([]);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    const [r, i, p, pi] = await Promise.all([
      supabase.from("recipes").select("id, name, yield_qty, yield_unit, is_stocked").eq("is_stocked", true).order("name"),
      supabase.from("ingredients").select("id, name, unit").order("name"),
      supabase
        .from("productions")
        .select("id, recipe_id, quantity_produced, produced_at, notes, recipes(name, yield_unit)")
        .order("produced_at", { ascending: false })
        .limit(500),
      supabase.from("production_items").select("id, production_id, ingredient_name, quantity, unit"),
    ]);
    setRecipes((r.data ?? []) as Recipe[]);
    setIngredients((i.data ?? []) as Ingredient[]);
    setProductions((p.data ?? []) as unknown as ProductionRow[]);
    setItems((pi.data ?? []) as ProductionItemRow[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // When recipe + produced change, pre-fill items proportionally
  useEffect(() => {
    if (!recipeId || !produced) return;
    const rec = recipes.find((r) => r.id === recipeId);
    if (!rec) return;
    const factor = Number(produced) / (Number(rec.yield_qty) || 1);
    if (!Number.isFinite(factor) || factor <= 0) return;
    (async () => {
      const { data } = await supabase
        .from("recipe_items")
        .select("id, item_type, ingredient_id, quantity, unit")
        .eq("recipe_id", recipeId);
      const ings = (data ?? []) as RecipeItem[];
      const drafts: DraftItem[] = [];
      for (const it of ings) {
        if (it.item_type !== "ingredient" || !it.ingredient_id) continue;
        const ing = ingredients.find((x) => x.id === it.ingredient_id);
        if (!ing) continue;
        drafts.push({
          ingredient_id: it.ingredient_id,
          ingredient_name: ing.name,
          baseUnit: ing.unit,
          quantity: String(Number(it.quantity) * factor),
          unit: ing.unit,
        });
      }
      setDraftItems(drafts);
    })();
  }, [recipeId, produced, recipes, ingredients]);

  function openNew() {
    setRecipeId("");
    setProduced("");
    setProducedAt(new Date().toISOString().slice(0, 16));
    setNotes("");
    setDraftItems([]);
    setQueue([]);
    setOpen(true);
  }

  function updateDraft(idx: number, patch: Partial<DraftItem>) {
    setDraftItems((d) => d.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function removeDraft(idx: number) {
    setDraftItems((d) => d.filter((_, i) => i !== idx));
  }
  function addDraft() {
    setDraftItems((d) => [...d, { ingredient_id: "", ingredient_name: "", baseUnit: "", quantity: "", unit: "" }]);
  }

  function validateCurrent(): QueuedProduction | null {
    const rec = recipes.find((r) => r.id === recipeId);
    if (!rec) { toast.error("Selecione uma ficha técnica"); return null; }
    const qty = Number(produced);
    if (!qty || qty <= 0) { toast.error("Quantidade produzida inválida"); return null; }
    for (const it of draftItems) {
      if (!it.ingredient_id) { toast.error("Selecione o insumo de todas as linhas"); return null; }
      const q = Number(it.quantity);
      if (!q || q <= 0) { toast.error(`Quantidade inválida para ${it.ingredient_name}`); return null; }
      const converted = convert(q, it.unit, it.baseUnit);
      if (converted === null) { toast.error(`Unidade ${it.unit} incompatível com ${it.baseUnit} (${it.ingredient_name})`); return null; }
    }
    return {
      key: crypto.randomUUID(),
      recipeId: rec.id,
      recipeName: rec.name,
      yieldUnit: rec.yield_unit,
      produced,
      producedAt,
      notes,
      items: draftItems,
    };
  }

  function addToQueue() {
    const q = validateCurrent();
    if (!q) return;
    setQueue((prev) => [...prev, q]);
    // reset form for next entry, keep date
    setRecipeId("");
    setProduced("");
    setNotes("");
    setDraftItems([]);
    toast.success("Produção adicionada à lista");
  }

  function removeFromQueue(key: string) {
    setQueue((prev) => prev.filter((q) => q.key !== key));
  }

  async function persistOne(q: QueuedProduction, restaurantId: string): Promise<string | null> {
    const { data: mirror } = await supabase
      .from("ingredients")
      .select("id")
      .eq("source_recipe_id", q.recipeId)
      .maybeSingle();
    if (!mirror) return `Ficha "${q.recipeName}" não tem insumo de estoque vinculado.`;

    const outMoves: { ingredient_id: string; quantity: number; unit: string; name: string }[] = [];
    for (const it of q.items) {
      const converted = convert(Number(it.quantity), it.unit, it.baseUnit)!;
      outMoves.push({ ingredient_id: it.ingredient_id, quantity: converted, unit: it.baseUnit, name: it.ingredient_name });
    }

    const { data: prod, error: pErr } = await supabase
      .from("productions")
      .insert({
        restaurant_id: restaurantId,
        recipe_id: q.recipeId,
        quantity_produced: Number(q.produced),
        produced_at: new Date(q.producedAt).toISOString(),
        notes: q.notes || null,
      })
      .select("id")
      .single();
    if (pErr || !prod) return pErr?.message ?? "Erro ao salvar produção";

    if (outMoves.length > 0) {
      const { error: piErr } = await supabase.from("production_items").insert(
        outMoves.map((m) => ({
          production_id: prod.id,
          ingredient_id: m.ingredient_id,
          ingredient_name: m.name,
          quantity: m.quantity,
          unit: m.unit,
        })),
      );
      if (piErr) return piErr.message;
    }

    const tag = `production:${prod.id}`;
    const occurredAt = new Date(q.producedAt).toISOString();
    const mvRows: Array<{ restaurant_id: string; ingredient_id: string; type: "in" | "out"; quantity: number; reason: string; notes: string; occurred_at: string }> = outMoves.map((m) => ({
      restaurant_id: restaurantId,
      ingredient_id: m.ingredient_id,
      type: "out" as const,
      quantity: m.quantity,
      reason: "Produção",
      notes: tag,
      occurred_at: occurredAt,
    }));
    mvRows.push({
      restaurant_id: restaurantId,
      ingredient_id: mirror.id,
      type: "in" as const,
      quantity: Number(q.produced),
      reason: "Produção",
      notes: tag,
      occurred_at: occurredAt,
    });
    const { error: mErr } = await supabase.from("stock_movements").insert(mvRows);
    if (mErr) return mErr.message;
    return null;
  }

  async function save() {
    // Build the final list: queued items + current form (if filled)
    const toSave = [...queue];
    if (recipeId || produced || draftItems.length > 0) {
      const current = validateCurrent();
      if (!current) return;
      toSave.push(current);
    }
    if (toSave.length === 0) return toast.error("Adicione ao menos uma produção");

    const { data: prof } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!prof?.restaurant_id) return toast.error("Restaurante não encontrado");

    setSaving(true);
    let ok = 0;
    const errors: string[] = [];
    for (const q of toSave) {
      const err = await persistOne(q, prof.restaurant_id);
      if (err) errors.push(`${q.recipeName}: ${err}`);
      else ok++;
    }
    setSaving(false);

    if (ok > 0) toast.success(`${ok} produção${ok > 1 ? "ões" : ""} registrada${ok > 1 ? "s" : ""}`);
    if (errors.length > 0) toast.error(errors.join(" | "));
    if (errors.length === 0) setOpen(false);
    load();
  }

  async function remove(p: ProductionRow) {
    if (!confirm("Excluir esta produção? As movimentações de estoque serão revertidas.")) return;
    // Delete stock movements tagged with this production
    await supabase.from("stock_movements").delete().eq("notes", `production:${p.id}`);
    // Delete production (cascade removes items)
    const { error } = await supabase.from("productions").delete().eq("id", p.id);
    if (error) return toast.error(error.message);
    toast.success("Produção excluída");
    load();
  }

  const filtered = useMemo(() => {
    return productions.filter((p) => {
      if (filterRecipe !== "all" && p.recipe_id !== filterRecipe) return false;
      if (filterFrom && p.produced_at < new Date(filterFrom).toISOString()) return false;
      if (filterTo) {
        const to = new Date(filterTo);
        to.setHours(23, 59, 59, 999);
        if (p.produced_at > to.toISOString()) return false;
      }
      return true;
    });
  }, [productions, filterRecipe, filterFrom, filterTo]);

  const itemsByProduction = useMemo(() => {
    const m = new Map<string, ProductionItemRow[]>();
    for (const it of items) {
      const arr = m.get(it.production_id) ?? [];
      arr.push(it);
      m.set(it.production_id, arr);
    }
    return m;
  }, [items]);

  const hasFilters = filterRecipe !== "all" || !!filterFrom || !!filterTo;

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="font-display text-2xl">Produção</h1>
          <p className="text-sm text-muted-foreground">Lance o que foi produzido na cozinha</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={openNew}><Plus className="h-4 w-4" /> Nova produção</Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Registrar produções</DialogTitle>
            </DialogHeader>
            <div className="grid gap-3">
              {queue.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-2 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Na lista ({queue.length}):</p>
                  {queue.map((q) => (
                    <div key={q.key} className="flex items-center justify-between gap-2 rounded bg-background border px-2 py-1 text-sm">
                      <span className="truncate">
                        <strong>{q.recipeName}</strong> · {q.produced} {q.yieldUnit} · {q.items.length} insumo{q.items.length !== 1 ? "s" : ""}
                      </span>
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeFromQueue(q.key)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Ficha técnica</Label>
                  <Select value={recipeId} onValueChange={setRecipeId}>
                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                    <SelectContent>
                      {recipes.length === 0 && (
                        <div className="px-2 py-1.5 text-xs text-muted-foreground">
                          Nenhuma ficha armazenada em estoque
                        </div>
                      )}
                      {recipes.map((r) => (
                        <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Quantidade produzida {recipeId && `(${recipes.find((r)=>r.id===recipeId)?.yield_unit})`}</Label>
                  <Input type="number" step="0.001" value={produced} onChange={(e) => setProduced(e.target.value)} />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Data/hora</Label>
                  <Input type="datetime-local" value={producedAt} onChange={(e) => setProducedAt(e.target.value)} />
                </div>
                <div>
                  <Label>Observação</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Insumos consumidos</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addDraft}>
                    <Plus className="h-3 w-3" /> Adicionar
                  </Button>
                </div>
                {draftItems.length === 0 && (
                  <p className="text-xs text-muted-foreground">Selecione uma ficha e a quantidade para listar os insumos.</p>
                )}
                <div className="space-y-2">
                  {draftItems.map((it, idx) => {
                    const units = it.baseUnit ? compatibleUnits(it.baseUnit) : [];
                    return (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-end rounded-md border p-2">
                        <div className="col-span-12 md:col-span-5">
                          <Label className="text-xs">Insumo</Label>
                          <Select
                            value={it.ingredient_id}
                            onValueChange={(v) => {
                              const ing = ingredients.find((x) => x.id === v);
                              updateDraft(idx, {
                                ingredient_id: v,
                                ingredient_name: ing?.name ?? "",
                                baseUnit: ing?.unit ?? "",
                                unit: ing?.unit ?? "",
                              });
                            }}
                          >
                            <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                            <SelectContent>
                              {ingredients.map((i) => (
                                <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-6 md:col-span-3">
                          <Label className="text-xs">Quantidade</Label>
                          <Input type="number" step="0.001" value={it.quantity} onChange={(e) => updateDraft(idx, { quantity: e.target.value })} />
                        </div>
                        <div className="col-span-4 md:col-span-3">
                          <Label className="text-xs">Unidade</Label>
                          <Select value={it.unit} onValueChange={(v) => updateDraft(idx, { unit: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {(units.length > 0 ? units : [it.baseUnit || "un"]).map((u) => (
                                <SelectItem key={u} value={u}>{u}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-2 md:col-span-1 flex justify-end">
                          <Button type="button" variant="ghost" size="icon" onClick={() => removeDraft(idx)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
              <Button onClick={save}>Registrar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filtros */}
      <div className="rounded-lg border bg-card p-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 items-end">
          <div>
            <Label className="text-xs">Ficha</Label>
            <Select value={filterRecipe} onValueChange={setFilterRecipe}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                {recipes.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">De</Label>
            <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Até</Label>
            <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
          </div>
          {hasFilters && (
            <Button variant="outline" onClick={() => { setFilterRecipe("all"); setFilterFrom(""); setFilterTo(""); }}>
              <X className="h-4 w-4" /> Limpar
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-lg border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Ficha</TableHead>
              <TableHead>Produzido</TableHead>
              <TableHead>Insumos</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">Carregando...</TableCell></TableRow>
            )}
            {!loading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={5} className="text-center text-sm text-muted-foreground py-6">
                <ChefHat className="h-6 w-6 mx-auto mb-2 opacity-50" />
                Nenhuma produção registrada
              </TableCell></TableRow>
            )}
            {filtered.map((p) => {
              const list = itemsByProduction.get(p.id) ?? [];
              return (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap text-sm">
                    {new Date(p.produced_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  </TableCell>
                  <TableCell>{p.recipes?.name ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {Number(p.quantity_produced)} {p.recipes?.yield_unit ?? ""}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {list.length === 0 ? "—" : list.map((it) => `${it.ingredient_name} (${Number(it.quantity)} ${it.unit})`).join(", ")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => remove(p)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
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
