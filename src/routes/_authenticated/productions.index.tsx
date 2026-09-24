import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMyRestaurantId } from "@/lib/profile";
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
} from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { ChefHat, Filter, Pencil, Plus, Trash2, X } from "lucide-react";
import { compatibleUnits, convert } from "@/lib/units";
import { syncRecipeStockIngredient } from "@/lib/recipe-stock";

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

function toLocalDatetimeInput(date: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function localDatetimeInputToIso(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return new Date(value).toISOString();
  const [, year, month, day, hour, minute] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute)).toISOString();
}

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
  const [producedUnit, setProducedUnit] = useState("");
  const [producedAt, setProducedAt] = useState(() => toLocalDatetimeInput(new Date()));
  const [notes, setNotes] = useState("");
  const [draftItems, setDraftItems] = useState<DraftItem[]>([]);
  const [queue, setQueue] = useState<QueuedProduction[]>([]);
  const [saving, setSaving] = useState(false);

  const currentRecipe = recipes.find((r) => r.id === recipeId);
  const producedUnitOptions = currentRecipe
    ? ["receita", ...compatibleUnits(currentRecipe.yield_unit)]
    : [];
  function effectiveProduced(value: string, unit: string, rec: Recipe | undefined): number | null {
    if (!rec) return null;
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (unit === "receita") return n * (Number(rec.yield_qty) || 1);
    const c = convert(n, unit, rec.yield_unit);
    return c;
  }
  const [editingId, setEditingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [r, i, p] = await Promise.all([
      supabase.from("recipes").select("id, name, yield_qty, yield_unit, is_stocked").eq("is_stocked", true).order("name"),
      supabase.from("ingredients").select("id, name, unit").order("name"),
      supabase
        .from("productions")
        .select("id, recipe_id, quantity_produced, produced_at, notes, recipes(name, yield_unit)")
        .order("produced_at", { ascending: false })
        .limit(500),
    ]);
    setRecipes((r.data ?? []) as Recipe[]);
    setIngredients((i.data ?? []) as Ingredient[]);
    const prodRows = (p.data ?? []) as unknown as ProductionRow[];
    setProductions(prodRows);
    const ids = prodRows.map((x) => x.id);
    let allItems: ProductionItemRow[] = [];
    for (let s = 0; s < ids.length; s += 100) {
      const { data: pi } = await supabase
        .from("production_items")
        .select("id, production_id, ingredient_name, quantity, unit")
        .in("production_id", ids.slice(s, s + 100))
        .limit(5000);
      allItems = allItems.concat((pi ?? []) as ProductionItemRow[]);
    }
    setItems(allItems);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // When recipe + produced change, pre-fill items proportionally (skip while editing)
  useEffect(() => {
    if (editingId) return;
    if (!recipeId || !produced) return;
    const rec = recipes.find((r) => r.id === recipeId);
    if (!rec) return;
    const eff = effectiveProduced(produced, producedUnit || rec.yield_unit, rec);
    if (eff === null) return;
    const factor = eff / (Number(rec.yield_qty) || 1);
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
          quantity: (Number(it.quantity) * factor).toFixed(3),
          unit: ing.unit,
        });
      }
      setDraftItems(drafts);
    })();
  }, [recipeId, produced, producedUnit, recipes, ingredients, editingId]);

  // Default produced unit when recipe changes
  useEffect(() => {
    if (!currentRecipe) { setProducedUnit(""); return; }
    setProducedUnit((u) => {
      if (u === "receita") return u;
      const opts = ["receita", ...compatibleUnits(currentRecipe.yield_unit)];
      return opts.includes(u) ? u : currentRecipe.yield_unit;
    });
  }, [recipeId, currentRecipe]);

  function openNew() {
    setEditingId(null);
    setRecipeId("");
    setProduced("");
    setProducedUnit("");
    setProducedAt(toLocalDatetimeInput(new Date()));
    setNotes("");
    setDraftItems([]);
    setQueue([]);
    setOpen(true);
  }

  async function openEdit(p: ProductionRow) {
    setEditingId(p.id);
    setQueue([]);
    setRecipeId(p.recipe_id);
    setProduced(String(p.quantity_produced));
    setProducedUnit(p.recipes?.yield_unit ?? "");
    setProducedAt(toLocalDatetimeInput(new Date(p.produced_at)));
    setNotes(p.notes ?? "");
    const list = itemsByProduction.get(p.id) ?? [];
    const drafts: DraftItem[] = list.map((it) => {
      const ing = ingredients.find((x) => x.name === it.ingredient_name);
      return {
        ingredient_id: ing?.id ?? "",
        ingredient_name: it.ingredient_name,
        baseUnit: ing?.unit ?? it.unit,
        quantity: Number(it.quantity).toFixed(3),
        unit: it.unit,
      };
    });
    setDraftItems(drafts);
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
    const eff = effectiveProduced(produced, producedUnit || rec.yield_unit, rec);
    if (eff === null || eff <= 0) { toast.error("Quantidade produzida inválida"); return null; }
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
      produced: String(eff),
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
    setProducedUnit("");
    setNotes("");
    setDraftItems([]);
    toast.success("Produção adicionada à lista");
  }

  function removeFromQueue(key: string) {
    setQueue((prev) => prev.filter((q) => q.key !== key));
  }

  async function persistOne(q: QueuedProduction, restaurantId: string): Promise<string | null> {
    let { data: mirror, error: mirrorErr } = await supabase
      .from("ingredients")
      .select("id")
      .eq("source_recipe_id", q.recipeId)
      .maybeSingle();
    if (mirrorErr) {
      console.error("[productions] mirror lookup error", mirrorErr);
      return `Erro buscando insumo da ficha: ${mirrorErr.message}`;
    }
    if (!mirror) {
      // Fallback: revincula insumo órfão de mesmo nome (evita duplicidade)
      const { data: byName } = await supabase
        .from("ingredients")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .ilike("name", q.recipeName)
        .is("source_recipe_id", null)
        .maybeSingle();
      if (byName) {
        await supabase.from("ingredients").update({ source_recipe_id: q.recipeId }).eq("id", byName.id);
        mirror = { id: byName.id };
      }
    }
    if (!mirror) {
      // Ficha marcada como armazenada em estoque mas sem insumo espelho ainda
      // (ex.: ficha antiga criada antes desse vínculo existir) — cria agora.
      await syncRecipeStockIngredient({
        recipeId: q.recipeId,
        restaurantId,
        isStocked: true,
        name: q.recipeName,
        unit: q.yieldUnit,
      });
      const { data: created } = await supabase
        .from("ingredients")
        .select("id")
        .eq("source_recipe_id", q.recipeId)
        .maybeSingle();
      mirror = created;
    }
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
        produced_at: localDatetimeInputToIso(q.producedAt),
        notes: q.notes || null,
      })
      .select("id")
      .single();
    if (pErr || !prod) {
      console.error("[productions] insert production error", pErr);
      return pErr?.message ?? "Erro ao salvar produção";
    }

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
      if (piErr) {
        console.error("[productions] insert production_items error", piErr);
        return `Itens: ${piErr.message}`;
      }
    }

    const tag = `production:${prod.id}`;
    const occurredAt = localDatetimeInputToIso(q.producedAt);
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
    if (mErr) {
      console.error("[productions] insert stock_movements error", mErr);
      return `Movimentações: ${mErr.message}`;
    }
    return null;
  }

  async function save() {
    const restaurantId = await getMyRestaurantId();
    if (!restaurantId) return toast.error("Restaurante não encontrado");

    if (editingId) {
      const current = validateCurrent();
      if (!current) return;
      setSaving(true);
      // Revert previous: delete movements + production (cascades items)
      await supabase.from("stock_movements").delete().eq("notes", `production:${editingId}`);
      const { error: delErr } = await supabase.from("productions").delete().eq("id", editingId);
      if (delErr) { setSaving(false); return toast.error(delErr.message); }
      const err = await persistOne(current, restaurantId);
      setSaving(false);
      if (err) return toast.error(err);
      toast.success("Produção atualizada");
      setOpen(false);
      setEditingId(null);
      load();
      return;
    }

    // Build the final list: queued items + current form (if filled)
    const toSave = [...queue];
    if (recipeId || produced || draftItems.length > 0) {
      const current = validateCurrent();
      if (!current) return;
      toSave.push(current);
    }
    if (toSave.length === 0) return toast.error("Adicione ao menos uma produção");

    setSaving(true);
    let ok = 0;
    const errors: string[] = [];
    for (const q of toSave) {
      const err = await persistOne(q, restaurantId);
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
    const parseLocal = (s: string, end = false) => {
      const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const d = new Date(+m[1], +m[2] - 1, +m[3]);
      if (end) d.setHours(23, 59, 59, 999);
      return d;
    };
    return productions.filter((p) => {
      if (filterRecipe !== "all" && p.recipe_id !== filterRecipe) return false;
      const occ = new Date(p.produced_at);
      const from = filterFrom ? parseLocal(filterFrom) : null;
      const to = filterTo ? parseLocal(filterTo, true) : null;
      if (from && occ < from) return false;
      if (to && occ > to) return false;
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
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="font-display text-2xl">Produção</h1>
          <p className="text-sm text-muted-foreground">Lance o que foi produzido na cozinha</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={openNew}><Plus className="h-4 w-4" /> Nova produção</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingId ? "Editar produção" : "Registrar produções"}</DialogTitle>
              </DialogHeader>
            <div className="grid gap-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <Label>Ficha técnica</Label>
                  <Select value={recipeId} onValueChange={setRecipeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione...">{currentRecipe?.name}</SelectValue>
                    </SelectTrigger>
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
                  <Label>Quantidade produzida</Label>
                  <div className="flex gap-2">
                    <Input
                      type="number"
                      step="0.001"
                      value={produced}
                      onChange={(e) => setProduced(e.target.value)}
                      className="flex-1"
                    />
                    <Select
                      value={producedUnit}
                      onValueChange={setProducedUnit}
                      disabled={!currentRecipe}
                    >
                      <SelectTrigger className="w-32"><SelectValue placeholder="un" /></SelectTrigger>
                      <SelectContent>
                        {producedUnitOptions.map((u) => (
                          <SelectItem key={u} value={u}>
                            {u === "receita" ? "receita(s)" : u}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {currentRecipe && producedUnit === "receita" && produced && (
                    <p className="text-xs text-muted-foreground mt-1">
                      = {(Number(produced) * Number(currentRecipe.yield_qty || 1)).toFixed(3)} {currentRecipe.yield_unit}
                    </p>
                  )}
                  {currentRecipe && producedUnit && producedUnit !== "receita" && producedUnit !== currentRecipe.yield_unit && produced && (() => {
                    const eff = effectiveProduced(produced, producedUnit, currentRecipe);
                    return eff !== null ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        = {eff.toFixed(3)} {currentRecipe.yield_unit}
                      </p>
                    ) : null;
                  })()}
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

              <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Insumos consumidos</Label>
                </div>
                {draftItems.length === 0 && (
                  <p className="text-xs text-muted-foreground">Selecione uma ficha e a quantidade para listar os insumos.</p>
                )}
                <div className="space-y-2">
                  {draftItems.map((it, idx) => {
                    const units = it.baseUnit ? compatibleUnits(it.baseUnit) : [];
                    return (
                      <div key={idx} className="grid grid-cols-12 gap-2 items-end rounded-md border bg-background p-2">
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
                            <SelectTrigger>
                              <SelectValue placeholder="Selecione...">
                                {it.ingredient_name || ingredients.find((x) => x.id === it.ingredient_id)?.name}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              {ingredients.map((i) => (
                                <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-6 md:col-span-3">
                          <Label className="text-xs">Quantidade</Label>
                          <Input
                            type="number"
                            step="0.001"
                            value={it.quantity}
                            onChange={(e) => updateDraft(idx, { quantity: e.target.value })}
                            onBlur={(e) => {
                              const n = Number(e.target.value);
                              if (Number.isFinite(n) && e.target.value !== "") {
                                updateDraft(idx, { quantity: n.toFixed(3) });
                              }
                            }}
                          />
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
                <Button type="button" variant="outline" size="sm" className="w-full" onClick={addDraft}>
                  <Plus className="h-3 w-3" /> Adicionar insumo
                </Button>
              </div>

              {!editingId && (
                <div className="space-y-1">
                  <Button type="button" onClick={addToQueue} disabled={saving} className="w-full">
                    <Plus className="h-4 w-4" /> Produção
                  </Button>
                  <p className="text-xs text-muted-foreground text-center">
                    Você pode lançar mais de uma produção de uma vez: preencha os dados acima, clique em "+ Produção" para guardar na lista e repita antes de registrar tudo.
                  </p>
                </div>
              )}

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
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancelar</Button>
              <Button onClick={save} disabled={saving}>
                {saving
                  ? (editingId ? "Salvando..." : "Registrando...")
                  : editingId
                    ? "Salvar alterações"
                    : queue.length > 0 ? `Registrar ${queue.length + (recipeId ? 1 : 0)}` : "Registrar"}
              </Button>
            </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
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
          <div className="min-w-0">
            <Label className="text-xs">De</Label>
            <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
          </div>
          <div className="min-w-0">
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
                  <TableCell className="text-right whitespace-nowrap">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(p)} title="Editar">
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => remove(p)} title="Excluir">
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

