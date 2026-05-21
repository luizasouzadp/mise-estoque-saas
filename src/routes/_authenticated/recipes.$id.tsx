import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, BookOpen, Package, Archive } from "lucide-react";
import { syncRecipeStockIngredient } from "@/lib/recipe-stock";
import { compatibleUnits, convert } from "@/lib/units";

export const Route = createFileRoute("/_authenticated/recipes/$id")({
  component: RecipeDetail,
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const UNITS = ["un", "porção", "kg", "g", "L", "ml", "cx", "pct"];

function RecipeDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();

  const { data: recipe, isLoading } = useQuery({
    queryKey: ["recipe", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, description, yield_qty, yield_unit, is_stocked, restaurant_id, is_on_menu, menu_category, current_price, product_code")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: items } = useQuery({
    queryKey: ["recipe-items", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipe_items")
        .select("id, item_type, ingredient_id, sub_recipe_id, quantity, unit")
        .eq("recipe_id", id)
        .order("created_at");
      if (error) throw error;

      // Enrich with names and unit costs
      const enriched = await Promise.all(
        (data ?? []).map(async (it) => {
          if (it.item_type === "ingredient" && it.ingredient_id) {
            const { data: ing } = await supabase.from("ingredients").select("name, unit").eq("id", it.ingredient_id).single();
            const { data: cost } = await supabase.rpc("ingredient_avg_cost_last_30d", { _ingredient_id: it.ingredient_id });
            const unitCost = Number(cost ?? 0);
            return { ...it, name: ing?.name ?? "—", baseUnit: ing?.unit ?? "", unitCost, lineCost: unitCost * Number(it.quantity) };
          } else if (it.sub_recipe_id) {
            const { data: sub } = await supabase.from("recipes").select("name, yield_qty, yield_unit").eq("id", it.sub_recipe_id).single();
            const { data: subTotal } = await supabase.rpc("recipe_total_cost", { _recipe_id: it.sub_recipe_id, _depth: 0 });
            const subYield = Number(sub?.yield_qty ?? 1) || 1;
            const unitCost = Number(subTotal ?? 0) / subYield;
            return { ...it, name: sub?.name ?? "—", baseUnit: sub?.yield_unit ?? "", unitCost, lineCost: unitCost * Number(it.quantity) };
          }
          return { ...it, name: "—", baseUnit: "", unitCost: 0, lineCost: 0 };
        }),
      );
      return enriched;
    },
  });

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

  const totalCost = (items ?? []).reduce((s, it) => s + it.lineCost, 0);
  const unitCost = recipe && Number(recipe.yield_qty) > 0 ? totalCost / Number(recipe.yield_qty) : 0;

  // Edit recipe state
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [yieldQty, setYieldQty] = useState("");
  const [yieldUnit, setYieldUnit] = useState("un");
  const [isStocked, setIsStocked] = useState<"no" | "yes">("no");
  const [isOnMenu, setIsOnMenu] = useState<"no" | "yes">("no");
  const [menuCategory, setMenuCategory] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [productCode, setProductCode] = useState("");

  function startEdit() {
    if (!recipe) return;
    setName(recipe.name);
    setDescription(recipe.description ?? "");
    setYieldQty(String(recipe.yield_qty));
    setYieldUnit(recipe.yield_unit);
    setIsStocked(recipe.is_stocked ? "yes" : "no");
    setIsOnMenu(recipe.is_on_menu ? "yes" : "no");
    setMenuCategory(recipe.menu_category ?? "");
    setCurrentPrice(recipe.current_price != null ? String(recipe.current_price) : "");
    setEditing(true);
  }

  async function saveRecipe() {
    if (!recipe) return;
    const newIsStocked = isStocked === "yes";
    const newIsOnMenu = isOnMenu === "yes";
    const { error } = await supabase.from("recipes").update({
      name, description: description || null,
      yield_qty: Number(yieldQty) || 1, yield_unit: yieldUnit,
      is_stocked: newIsStocked,
      is_on_menu: newIsOnMenu,
      menu_category: newIsOnMenu ? (menuCategory || null) : null,
      current_price: newIsOnMenu && currentPrice ? Number(currentPrice) : null,
    }).eq("id", id);
    if (error) return toast.error(error.message);
    await syncRecipeStockIngredient({
      recipeId: id,
      restaurantId: recipe.restaurant_id,
      isStocked: newIsStocked,
      name,
      unit: yieldUnit,
    });
    toast.success("Ficha atualizada");
    setEditing(false);
    qc.invalidateQueries({ queryKey: ["recipe", id] });
    qc.invalidateQueries({ queryKey: ["recipes"] });
    qc.invalidateQueries({ queryKey: ["ingredients"] });
  }

  async function deleteRecipe() {
    if (!confirm("Excluir esta ficha técnica?")) return;
    // Insumo espelho NÃO é removido aqui — só ao editar a ficha e marcar
    // "Armazenada em estoque?" como "Não". Apenas desvincula a referência.
    await supabase.from("ingredients").update({ source_recipe_id: null }).eq("source_recipe_id", id);
    const { error } = await supabase.from("recipes").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Ficha excluída");
    qc.invalidateQueries({ queryKey: ["recipes"] });
    qc.invalidateQueries({ queryKey: ["ingredients"] });
    nav({ to: "/recipes" });
  }

  async function resyncStockCost() {
    if (!recipe?.is_stocked) return;
    await syncRecipeStockIngredient({
      recipeId: id,
      restaurantId: recipe.restaurant_id,
      isStocked: true,
      name: recipe.name,
      unit: recipe.yield_unit,
    });
  }

  // Add item form
  const [itemType, setItemType] = useState<"ingredient" | "recipe">("ingredient");
  const [targetId, setTargetId] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("un");
  const [adding, setAdding] = useState(false);

  // Base unit for the selected target (ingredient.unit or recipe.yield_unit)
  const selectedBaseUnit =
    itemType === "ingredient"
      ? ingredients?.find((i) => i.id === targetId)?.unit ?? ""
      : allRecipes?.find((r) => r.id === targetId)?.yield_unit ?? "";
  const unitOptions = selectedBaseUnit ? compatibleUnits(selectedBaseUnit) : [];

  // Auto-preenche a unidade com a padrão do insumo/ficha selecionado
  useEffect(() => {
    if (selectedBaseUnit) setUnit(selectedBaseUnit);
  }, [selectedBaseUnit]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId || !qty) return toast.error("Selecione o item e informe a quantidade");
    if (itemType === "recipe" && targetId === id) return toast.error("Uma ficha não pode usar a si mesma");
    const converted = convert(Number(qty), unit, selectedBaseUnit);
    if (converted === null) return toast.error(`Unidade ${unit} não é compatível com ${selectedBaseUnit}`);
    setAdding(true);
    const payload = {
      recipe_id: id,
      item_type: itemType,
      ingredient_id: itemType === "ingredient" ? targetId : null,
      sub_recipe_id: itemType === "recipe" ? targetId : null,
      quantity: converted,
      unit: selectedBaseUnit,
    };
    const { error } = await supabase.from("recipe_items").insert(payload);
    setAdding(false);
    if (error) return toast.error(error.message);
    setTargetId(""); setQty("");
    await resyncStockCost();
    qc.invalidateQueries({ queryKey: ["recipe-items", id] });
    qc.invalidateQueries({ queryKey: ["recipes"] });
    qc.invalidateQueries({ queryKey: ["ingredients"] });
  }

  async function removeItem(itemId: string) {
    const { error } = await supabase.from("recipe_items").delete().eq("id", itemId);
    if (error) return toast.error(error.message);
    await resyncStockCost();
    qc.invalidateQueries({ queryKey: ["recipe-items", id] });
    qc.invalidateQueries({ queryKey: ["recipes"] });
    qc.invalidateQueries({ queryKey: ["ingredients"] });
  }

  if (isLoading || !recipe) {
    return <div className="mx-auto max-w-4xl p-4 md:p-8"><p className="text-sm text-muted-foreground">Carregando...</p></div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-8">
      <Link to="/recipes" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>

      {/* Header / edit */}
      <div className="rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
        {!editing ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="font-display text-3xl">{recipe.name}</h1>
                  {recipe.is_stocked && (
                    <Badge variant="secondary" className="gap-1">
                      <Archive className="h-3 w-3" /> Pré-preparo em estoque
                    </Badge>
                  )}
                </div>
                {recipe.description && <p className="mt-1 text-sm text-muted-foreground whitespace-pre-line">{recipe.description}</p>}
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={startEdit}>Editar</Button>
                <Button variant="ghost" size="sm" onClick={deleteRecipe}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <Stat label="Rendimento" value={`${Number(recipe.yield_qty)} ${recipe.yield_unit}`} />
              <Stat label="Custo total" value={BRL.format(totalCost)} />
              <Stat label={`Custo por ${recipe.yield_unit}`} value={BRL.format(unitCost)} highlight />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Custos calculados pela média ponderada das compras dos últimos 30 dias (com fallback para a média histórica quando não há compras recentes).
            </p>
          </>
        ) : (
          <div className="space-y-4">
            <div>
              <Label>Nome</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label>Rendimento</Label>
                <Input type="number" step="0.01" min="0.01" value={yieldQty} onChange={(e) => setYieldQty(e.target.value)} />
              </div>
              <div>
                <Label>Unidade</Label>
                <Select value={yieldUnit} onValueChange={setYieldUnit}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Armazenada em estoque?</Label>
              <p className="text-xs text-muted-foreground mb-2">
                Se sim, gera um insumo de categoria <strong>pré-preparo</strong> usado em grupos e inventários.
              </p>
              <RadioGroup value={isStocked} onValueChange={(v) => setIsStocked(v as "no" | "yes")} className="flex gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="no" id="edit-st-no" /> <span>Não</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="yes" id="edit-st-yes" /> <span>Sim</span>
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
                  <RadioGroupItem value="no" id="edit-menu-no" /> <span>Não</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <RadioGroupItem value="yes" id="edit-menu-yes" /> <span>Sim</span>
                </label>
              </RadioGroup>
            </div>
            {isOnMenu === "yes" && (
              <div className="grid gap-4 sm:grid-cols-2">
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
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
              <Button onClick={saveRecipe}>Salvar</Button>
            </div>
          </div>
        )}
      </div>

      {/* Items list */}
      <div className="rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
        <h2 className="font-display text-xl">Composição</h2>
        <p className="text-sm text-muted-foreground">Insumos e sub-receitas que compõem esta ficha.</p>

        <div className="mt-4 space-y-2">
          {(items ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum item adicionado ainda.</p>
          ) : (
            items!.map((it) => (
              <div key={it.id} className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
                <div className="flex items-center gap-3 min-w-0">
                  {it.item_type === "ingredient" ? <Package className="h-4 w-4 text-muted-foreground shrink-0" /> : <BookOpen className="h-4 w-4 text-primary shrink-0" />}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {it.item_type === "recipe" ? (
                        <Link to="/recipes/$id" params={{ id: it.sub_recipe_id! }} className="hover:text-primary">{it.name}</Link>
                      ) : it.name}
                    </p>
                    <p className="text-xs text-muted-foreground">{Number(it.quantity)} {it.unit} · {BRL.format(it.unitCost)} / {it.baseUnit || it.unit}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-semibold">{BRL.format(it.lineCost)}</p>
                  <Button variant="ghost" size="icon" onClick={() => removeItem(it.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Add item form */}
        <form onSubmit={addItem} className="mt-5 grid gap-3 rounded-lg border bg-background p-4 sm:grid-cols-12">
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
                  : (allRecipes ?? []).filter((r) => r.id !== id).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
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
            <Button type="submit" disabled={adding}><Plus className="mr-2 h-4 w-4" /> Adicionar</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-lg font-semibold ${highlight ? "text-primary" : ""}`}>{value}</p>
    </div>
  );
}
