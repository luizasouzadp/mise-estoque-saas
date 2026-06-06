import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Package, BookOpen, Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { syncRecipeStockIngredient } from "@/lib/recipe-stock";
import { compatibleUnits, convert } from "@/lib/units";

export const Route = createFileRoute("/_authenticated/recipes/new")({
  component: NewRecipe,
});

const UNITS = ["un", "porção", "kg", "g", "L", "ml", "cx", "pct"];

type DraftItem = {
  key: string;
  item_type: "ingredient" | "recipe";
  target_id: string;
  target_name: string;
  quantity: number;
  unit: string;
};

function NewRecipe() {
  const nav = useNavigate();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [yieldQty, setYieldQty] = useState("1");
  const [yieldUnit, setYieldUnit] = useState("un");
  const [isStocked, setIsStocked] = useState<"no" | "yes">("no");
  const [isOnMenu, setIsOnMenu] = useState<"no" | "yes">("no");
  const [menuCategory, setMenuCategory] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [productCode, setProductCode] = useState("");
  const [saving, setSaving] = useState(false);

  // Composition draft
  const [items, setItems] = useState<DraftItem[]>([]);
  const [itemType, setItemType] = useState<"ingredient" | "recipe">("ingredient");
  const [targetId, setTargetId] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("un");

  const { data: ingredients } = useQuery({
    queryKey: ["ingredients-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("ingredients").select("id, name, unit").order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: allRecipes } = useQuery({
    queryKey: ["recipes-min"],
    queryFn: async () => {
      const { data, error } = await supabase.from("recipes").select("id, name, yield_unit").order("name");
      if (error) throw error;
      return data;
    },
  });

  const selectedBaseUnit =
    itemType === "ingredient"
      ? ingredients?.find((i) => i.id === targetId)?.unit ?? ""
      : allRecipes?.find((r) => r.id === targetId)?.yield_unit ?? "";
  const unitOptions = selectedBaseUnit ? compatibleUnits(selectedBaseUnit) : [];

  useEffect(() => {
    if (selectedBaseUnit) setUnit(selectedBaseUnit);
  }, [selectedBaseUnit]);

  function addDraftItem() {
    if (!targetId || !qty) return toast.error("Selecione um item e a quantidade");
    const converted = convert(Number(qty), unit, selectedBaseUnit);
    if (converted === null) return toast.error(`Unidade ${unit} não é compatível com ${selectedBaseUnit}`);
    let targetName = "";
    if (itemType === "ingredient") {
      targetName = ingredients?.find((i) => i.id === targetId)?.name ?? "";
    } else {
      targetName = allRecipes?.find((r) => r.id === targetId)?.name ?? "";
    }
    setItems((prev) => [
      ...prev,
      { key: crypto.randomUUID(), item_type: itemType, target_id: targetId, target_name: targetName, quantity: converted, unit: selectedBaseUnit },
    ]);
    setTargetId(""); setQty("");
  }

  function removeDraft(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Informe o nome");
    setSaving(true);
    const { data: profile } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
    if (!profile?.restaurant_id) {
      setSaving(false);
      return toast.error("Restaurante não encontrado.");
    }
    const { data: recipe, error } = await supabase.from("recipes").insert({
      restaurant_id: profile.restaurant_id,
      name,
      description: description || null,
      yield_qty: Number(yieldQty) || 1,
      yield_unit: yieldUnit,
      is_stocked: isStocked === "yes",
      is_on_menu: isOnMenu === "yes",
      menu_category: isOnMenu === "yes" ? (menuCategory || null) : null,
      current_price: isOnMenu === "yes" && currentPrice ? Number(currentPrice) : null,
      product_code: isOnMenu === "yes" && productCode ? productCode.trim() : null,
    }).select("id").single();

    if (error || !recipe) {
      setSaving(false);
      return toast.error(error?.message ?? "Erro ao criar ficha");
    }

    if (items.length > 0) {
      const payload = items.map((it) => ({
        recipe_id: recipe.id,
        item_type: it.item_type,
        ingredient_id: it.item_type === "ingredient" ? it.target_id : null,
        sub_recipe_id: it.item_type === "recipe" ? it.target_id : null,
        quantity: it.quantity,
        unit: it.unit,
      }));
      const { error: itemsErr } = await supabase.from("recipe_items").insert(payload);
      if (itemsErr) {
        setSaving(false);
        return toast.error("Ficha criada, mas falhou ao salvar itens: " + itemsErr.message);
      }
    }

    if (isStocked === "yes") {
      await syncRecipeStockIngredient({
        recipeId: recipe.id,
        restaurantId: profile.restaurant_id,
        isStocked: true,
        name,
        unit: yieldUnit,
      });
    }

    setSaving(false);
    toast.success("Ficha criada!");
    qc.invalidateQueries({ queryKey: ["recipes"] });
    qc.invalidateQueries({ queryKey: ["ingredients"] });
    nav({ to: "/recipes/$id", params: { id: recipe.id } });
  }

  return (
    <div className="mx-auto max-w-3xl p-4 md:p-8">
      <Link to="/recipes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <h1 className="mt-3 font-display text-3xl">Nova ficha técnica</h1>
      <p className="text-sm text-muted-foreground">Defina os dados, monte a composição e salve tudo de uma vez.</p>

      <form onSubmit={onSubmit} className="mt-6 space-y-6">
        {/* Dados */}
        <div className="space-y-4 rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
          <div>
            <Label htmlFor="name">Nome do produto / receita</Label>
            <Input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Molho de tomate" />
          </div>
          <div>
            <Label htmlFor="desc">Descrição (opcional)</Label>
            <Textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Modo de preparo, observações..." />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="qty">Rendimento</Label>
              <Input id="qty" type="number" step="0.01" min="0.01" required value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="u">Unidade de rendimento</Label>
              <Select value={yieldUnit} onValueChange={setYieldUnit}>
                <SelectTrigger id="u"><SelectValue /></SelectTrigger>
                <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Esta ficha fica armazenada em estoque?</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Se sim, será criado um insumo de categoria <strong>pré-preparo</strong>, que pode entrar em grupos e inventários.
            </p>
            <RadioGroup value={isStocked} onValueChange={(v) => setIsStocked(v as "no" | "yes")} className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="no" id="st-no" /> <span>Não</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="yes" id="st-yes" /> <span>Sim</span>
              </label>
            </RadioGroup>
          </div>

          <div>
            <Label>Faz parte do cardápio?</Label>
            <p className="text-xs text-muted-foreground mb-2">
              Se sim, aparecerá na aba <strong>Precificação</strong>.
            </p>
            <RadioGroup value={isOnMenu} onValueChange={(v) => setIsOnMenu(v as "no" | "yes")} className="flex gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="no" id="menu-no" /> <span>Não</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="yes" id="menu-yes" /> <span>Sim</span>
              </label>
            </RadioGroup>
          </div>
          {isOnMenu === "yes" && (
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label>Código do produto</Label>
                <Input value={productCode} onChange={(e) => setProductCode(e.target.value)} placeholder="Ex.: 001" />
              </div>
              <div>
                <Label>Categoria do cardápio</Label>
                <Input value={menuCategory} onChange={(e) => setMenuCategory(e.target.value)} placeholder="Ex.: Pratos, Bebidas..." />
              </div>
              <div>
                <Label>Preço de venda atual (R$)</Label>
                <Input type="number" step="0.01" min="0" value={currentPrice} onChange={(e) => setCurrentPrice(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {/* Composição */}
        <div className="space-y-4 rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
          <div>
            <h2 className="font-display text-xl">Composição</h2>
            <p className="text-sm text-muted-foreground">Adicione insumos e sub-receitas que compõem esta ficha.</p>
          </div>

          <div className="space-y-2">
            {items.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum item adicionado.</p>
            ) : items.map((it) => (
              <div key={it.key} className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
                <div className="flex items-center gap-3 min-w-0">
                  {it.item_type === "ingredient" ? <Package className="h-4 w-4 text-muted-foreground shrink-0" /> : <BookOpen className="h-4 w-4 text-primary shrink-0" />}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{it.target_name}</p>
                    <p className="text-xs text-muted-foreground">{it.quantity} {it.unit}</p>
                  </div>
                </div>
                <Button type="button" variant="ghost" size="icon" onClick={() => removeDraft(it.key)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="grid gap-3 rounded-lg border bg-background p-4 sm:grid-cols-12">
            <div className="sm:col-span-3">
              <Label>Tipo</Label>
              <Select value={itemType} onValueChange={(v: "ingredient" | "recipe") => { setItemType(v); setTargetId(""); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ingredient">Insumo</SelectItem>
                  <SelectItem value="recipe">Sub-receita</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-5">
              <Label>{itemType === "ingredient" ? "Insumo" : "Ficha"}</Label>
              <Select value={targetId} onValueChange={(v) => {
                setTargetId(v);
                if (itemType === "ingredient") {
                  const ing = ingredients?.find((i) => i.id === v);
                  if (ing) setUnit(ing.unit);
                } else {
                  const r = allRecipes?.find((r) => r.id === v);
                  if (r) setUnit(r.yield_unit);
                }
              }}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {itemType === "ingredient"
                    ? (ingredients ?? []).map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)
                    : (allRecipes ?? []).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label>Qtd.</Label>
              <Input type="number" step="0.001" min="0" value={qty} onChange={(e) => setQty(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label>Unid.</Label>
              <Select value={unit} onValueChange={setUnit} disabled={!selectedBaseUnit}>
                <SelectTrigger><SelectValue placeholder={selectedBaseUnit || "—"} /></SelectTrigger>
                <SelectContent>{unitOptions.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="sm:col-span-12 flex justify-end">
              <Button type="button" variant="outline" onClick={addDraftItem}><Plus className="mr-2 h-4 w-4" /> Adicionar item</Button>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => nav({ to: "/recipes" })}>Cancelar</Button>
          <Button type="submit" disabled={saving}>{saving ? "Salvando..." : "Criar ficha"}</Button>
        </div>
      </form>
    </div>
  );
}
