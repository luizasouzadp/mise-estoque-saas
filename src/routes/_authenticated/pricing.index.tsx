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
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Plus, Trash2, X, ChevronDown } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/pricing/")({
  component: PricingPage,
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type MenuItem = {
  ref_type: "ingredient" | "recipe";
  ref_id: string;
  name: string;
  unit: string;
  quantity: number;
  unit_cost?: number;
};

type MenuProduct = {
  id: string;
  name: string;
  category: string | null;
  current_price: number | null;
  cost: number;
  items: MenuItem[];
  product_code: string | null;
};


type Row = {
  id: string;
  name: string;
  menu_category: string | null;
  current_price: number | null;
  yield_qty: number;
  yield_unit: string;
  unit_cost: number;
  product_code: string | null;
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
        .select("id, name, menu_category, current_price, yield_qty, yield_unit, product_code")
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

  const { data: manualProducts } = useQuery<MenuProduct[]>({
    queryKey: ["manual-menu-products"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("menu_products")
        .select("id, name, category, current_price, cost, items, product_code")
        .order("name");
      if (error) throw error;
      return (data ?? []).map((p: any) => ({ ...p, items: Array.isArray(p.items) ? p.items : [] }));
    },
  });


  const [filter, setFilter] = useState<"all" | "above" | "below">("all");
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);

  type UnifiedRow = {
    source: "recipe" | "manual";
    id: string;
    name: string;
    category: string | null;
    current_price: number | null;
    unit_cost: number;
    subtitle?: string;
    yield_unit?: string;
    product_code: string | null;
  };

  const unified: UnifiedRow[] = useMemo(() => {
    const recipeRows: UnifiedRow[] = (rows ?? []).map((r) => ({
      source: "recipe",
      id: r.id,
      name: r.name,
      category: r.menu_category,
      current_price: r.current_price,
      unit_cost: r.unit_cost,
      subtitle: `por ${r.yield_unit}`,
      yield_unit: r.yield_unit,
      product_code: r.product_code,
    }));
    const manualRows: UnifiedRow[] = (manualProducts ?? []).map((p) => ({
      source: "manual",
      id: p.id,
      name: p.name,
      category: p.category,
      current_price: p.current_price,
      unit_cost: Number(p.cost) || 0,
      subtitle: p.items.length > 0 ? p.items.map((i) => `${i.quantity} ${i.unit} ${i.name}`).join(" • ") : undefined,
      product_code: p.product_code,
    }));
    return [...recipeRows, ...manualRows].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, manualProducts]);


  const enrichedRows = useMemo(() => {
    return unified.map((r) => {
      const idealPrice = idealCmv > 0 ? r.unit_cost / (idealCmv / 100) : 0;
      const currentCmv = r.current_price && r.current_price > 0 ? (r.unit_cost / r.current_price) * 100 : null;
      return { ...r, idealPrice, currentCmv };
    });
  }, [unified, idealCmv]);

  const filtered = useMemo(() => {
    return enrichedRows.filter((r) => {
      if (search && !r.name.toLowerCase().includes(search.toLowerCase()) && !(r.category ?? "").toLowerCase().includes(search.toLowerCase())) return false;
      if (filter === "above") return r.currentCmv != null && r.currentCmv > idealCmv;
      if (filter === "below") return r.currentCmv != null && r.currentCmv <= idealCmv;
      return true;
    });
  }, [enrichedRows, filter, search, idealCmv]);

  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    for (const r of unified) if (r.category) set.add(r.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [unified]);

  async function updateRecipe(id: string, patch: { current_price?: number | null; menu_category?: string | null; product_code?: string | null }) {
    const { error } = await supabase.from("recipes").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["pricing-rows"] });
  }
  async function updateManual(id: string, patch: { current_price?: number | null; category?: string | null; product_code?: string | null }) {
    const { error } = await (supabase as any).from("menu_products").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["manual-menu-products"] });
  }

  async function removeManual(id: string) {
    if (!confirm("Excluir este produto?")) return;
    const { error } = await (supabase as any).from("menu_products").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Produto excluído");
    qc.invalidateQueries({ queryKey: ["manual-menu-products"] });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl">Precificação</h1>
          <p className="text-sm text-muted-foreground">Defina seu CMV ideal e acompanhe a saúde dos preços do seu cardápio.</p>
        </div>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-1" /> Adicionar produto</Button>
          </DialogTrigger>
          <ManualProductDialog onClose={() => setAddOpen(false)} existingCategories={existingCategories} />
        </Dialog>
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

      {/* Unified table */}
      <div className="rounded-xl border bg-card shadow-[var(--shadow-soft)]">
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nenhum item no cardápio. Adicione um produto manualmente ou marque uma <Link to="/recipes" className="text-primary hover:underline">ficha técnica</Link> como parte do cardápio.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Código</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Preço ideal</TableHead>
                <TableHead className="text-right">Preço atual</TableHead>
                <TableHead className="text-right">CMV atual</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>

            <TableBody>
              {filtered.map((r) => {
                const above = r.currentCmv != null && r.currentCmv > idealCmv;
                const below = r.currentCmv != null && r.currentCmv <= idealCmv;
                return (
                  <TableRow key={`${r.source}:${r.id}`}>
                    <TableCell>
                      <CodeInput
                        value={r.product_code}
                        onCommit={(v) => {
                          if ((v ?? null) === (r.product_code ?? null)) return;
                          if (r.source === "recipe") updateRecipe(r.id, { product_code: v });
                          else updateManual(r.id, { product_code: v });
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      {r.source === "recipe" ? (
                        <Link to="/recipes/$id" params={{ id: r.id }} className="font-medium hover:text-primary">{r.name}</Link>
                      ) : (
                        <span className="font-medium">{r.name}</span>
                      )}
                      {r.subtitle && <div className="text-xs text-muted-foreground">{r.subtitle}</div>}
                    </TableCell>

                    <TableCell>
                      <CategoryCell
                        value={r.category}
                        options={existingCategories}
                        onChange={(v) => {
                          if (r.source === "recipe") updateRecipe(r.id, { menu_category: v });
                          else updateManual(r.id, { category: v });
                        }}
                      />
                    </TableCell>
                    <TableCell className="text-right">{BRL.format(r.unit_cost)}</TableCell>
                    <TableCell className="text-right">{BRL.format(r.idealPrice)}</TableCell>
                    <TableCell className="text-right">
                      <CurrencyInput
                        value={r.current_price}
                        onCommit={(v) => {
                          if (v === r.current_price) return;
                          if (r.source === "recipe") updateRecipe(r.id, { current_price: v });
                          else updateManual(r.id, { current_price: v });
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
                    <TableCell className="text-right">
                      {r.source === "manual" ? (
                        <Button variant="ghost" size="icon" onClick={() => removeManual(r.id)}>
                          <Trash2 className="text-destructive" />
                        </Button>
                      ) : null}
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
function CodeInput({ value, onCommit }: { value: string | null; onCommit: (v: string | null) => void }) {
  const [draft, setDraft] = useState<string>(value ?? "");
  return (
    <Input
      className="h-8"
      value={draft}
      placeholder="—"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const v = draft.trim();
        onCommit(v === "" ? null : v);
      }}
    />
  );
}


function CurrencyInput({ value, onCommit }: { value: number | null; onCommit: (v: number | null) => void }) {
  const [draft, setDraft] = useState<string>(value != null ? String(value).replace(".", ",") : "");
  return (
    <div className="relative ml-auto w-32">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
      <Input
        inputMode="decimal"
        value={draft}
        placeholder="0,00"
        className="h-8 pl-8 text-right"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const norm = draft.replace(/\./g, "").replace(",", ".").trim();
          const n = norm === "" ? null : Number(norm);
          if (n != null && Number.isNaN(n)) return;
          onCommit(n);
        }}
      />
    </div>
  );
}

function CategoryCell({ value, options, onChange }: { value: string | null; options: string[]; onChange: (v: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  if (editing) {
    return (
      <Input
        autoFocus
        className="h-8"
        value={draft}
        placeholder="Nova categoria"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const v = draft.trim();
          setEditing(false);
          if (v && v !== value) onChange(v);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      />
    );
  }
  return (
    <Select
      value={value ?? "__none"}
      onValueChange={(v) => {
        if (v === "__new") { setDraft(""); setEditing(true); return; }
        if (v === "__none") { onChange(null); return; }
        if (v !== value) onChange(v);
      }}
    >
      <SelectTrigger className="h-8"><SelectValue placeholder="—" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">—</SelectItem>
        {options.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        <SelectItem value="__new">+ Nova categoria</SelectItem>
      </SelectContent>
    </Select>
  );
}


type PickerOption = { key: string; ref_type: "ingredient" | "recipe"; ref_id: string; name: string; unit: string };

function ManualProductDialog({ onClose, existingCategories }: { onClose: () => void; existingCategories: string[] }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [price, setPrice] = useState("");
  const [items, setItems] = useState<{ key: string; quantity: string }[]>([{ key: "", quantity: "" }]);
  const [saving, setSaving] = useState(false);

  const { data: options } = useQuery<PickerOption[]>({
    queryKey: ["menu-product-picker"],
    queryFn: async () => {
      const [{ data: ings }, { data: recs }] = await Promise.all([
        supabase.from("ingredients").select("id, name, unit").order("name"),
        supabase.from("recipes").select("id, name, yield_unit").order("name"),
      ]);
      const a: PickerOption[] = (ings ?? []).map((i) => ({ key: `ingredient:${i.id}`, ref_type: "ingredient", ref_id: i.id, name: i.name, unit: i.unit }));
      const b: PickerOption[] = (recs ?? []).map((r) => ({ key: `recipe:${r.id}`, ref_type: "recipe", ref_id: r.id, name: r.name, unit: r.yield_unit }));
      return [...a, ...b];
    },
  });

  function setItem(idx: number, patch: Partial<{ key: string; quantity: string }>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }
  function addItem() { setItems((p) => [...p, { key: "", quantity: "" }]); }
  function removeItem(idx: number) { setItems((p) => p.filter((_, i) => i !== idx)); }

  async function save() {
    if (!name.trim()) return toast.error("Informe o nome do produto");
    setSaving(true);
    const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!profile?.restaurant_id) { setSaving(false); return toast.error("Restaurante não encontrado"); }

    const resolved: MenuItem[] = [];
    let totalCost = 0;
    for (const it of items) {
      const opt = options?.find((o) => o.key === it.key);
      const qty = Number(it.quantity);
      if (!opt || !(qty > 0)) continue;
      let unitCost = 0;
      if (opt.ref_type === "ingredient") {
        const { data } = await supabase.rpc("ingredient_avg_cost_last_30d", { _ingredient_id: opt.ref_id });
        unitCost = Number(data ?? 0);
      } else {
        const { data } = await supabase.rpc("recipe_unit_cost", { _recipe_id: opt.ref_id });
        unitCost = Number(data ?? 0);
      }
      totalCost += qty * unitCost;
      resolved.push({ ref_type: opt.ref_type, ref_id: opt.ref_id, name: opt.name, unit: opt.unit, quantity: qty, unit_cost: unitCost });
    }

    const { error } = await (supabase as any).from("menu_products").insert({
      restaurant_id: profile.restaurant_id,
      name: name.trim(),
      category: category.trim() || null,
      current_price: price === "" ? null : Number(price),
      cost: totalCost,
      items: resolved,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("Produto adicionado");
    qc.invalidateQueries({ queryKey: ["manual-menu-products"] });
    setName("");
    setCategory("");
    setPrice("");
    setItems([{ key: "", quantity: "" }]);
    onClose();
  }

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Adicionar produto manual</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>Nome</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Coca-Cola Lata, Combo Família" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Categoria</Label>
            <CategoryPicker value={category} options={existingCategories} onChange={setCategory} />
          </div>
          <div>
            <Label>Preço de venda</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">R$</span>
              <Input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0,00" className="pl-9" />
            </div>
          </div>
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <Label>Itens do produto</Label>
            <Button type="button" variant="outline" size="sm" onClick={addItem}><Plus /> Item</Button>
          </div>
          <p className="text-xs text-muted-foreground mb-2">O custo será calculado automaticamente a partir dos itens selecionados.</p>
          <div className="space-y-2">
            {items.map((it, idx) => {
              const opt = options?.find((o) => o.key === it.key);
              return (
                <div key={idx} className="flex gap-2">
                  <Input className="w-20" type="number" step="0.01" min="0" placeholder="Qtd" value={it.quantity} onChange={(e) => setItem(idx, { quantity: e.target.value })} />
                  <span className="self-center text-xs text-muted-foreground w-10">{opt?.unit ?? ""}</span>
                  <Select value={it.key} onValueChange={(v) => setItem(idx, { key: v })}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Selecione um item" /></SelectTrigger>
                    <SelectContent>
                      {(options ?? []).map((o) => (
                        <SelectItem key={o.key} value={o.key}>
                          {o.ref_type === "recipe" ? "🍳 " : "📦 "}{o.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeItem(idx)}><X /></Button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancelar</Button>
        <Button onClick={save} disabled={saving}>{saving ? "Salvando..." : "Salvar"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function CategoryPicker({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  const [mode, setMode] = useState<"select" | "new">(value && !options.includes(value) ? "new" : "select");
  if (mode === "new") {
    return (
      <div className="flex gap-2">
        <Input autoFocus value={value} onChange={(e) => onChange(e.target.value)} placeholder="Nova categoria" />
        {options.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => { onChange(""); setMode("select"); }}>Lista</Button>
        )}
      </div>
    );
  }
  return (
    <Select
      value={value || "__none"}
      onValueChange={(v) => {
        if (v === "__new") { onChange(""); setMode("new"); return; }
        if (v === "__none") { onChange(""); return; }
        onChange(v);
      }}
    >
      <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">Sem categoria</SelectItem>
        {options.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
        <SelectItem value="__new">+ Nova categoria</SelectItem>
      </SelectContent>
    </Select>
  );
}
