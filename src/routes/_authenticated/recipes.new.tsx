import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/searchable-select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, Package, Check, ChevronsUpDown } from "lucide-react";
import { cn, normalizeName } from "@/lib/utils";
import { syncRecipeStockIngredient } from "@/lib/recipe-stock";
import { compatibleUnits, convert } from "@/lib/units";

export const Route = createFileRoute("/_authenticated/recipes/new")({
  component: NewRecipe,
});

const UNITS = ["un", "porção", "kg", "g", "L", "ml", "cx", "pct"];

type DraftItem = {
  key: string;
  item_type: "ingredient";
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
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error("Imagem deve ter no máximo 5MB");
    setUploadingImage(true);
    const ext = file.name.split(".").pop() || "jpg";
    const path = `${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("recipe-images").upload(path, file, { upsert: false, contentType: file.type });
    if (error) {
      setUploadingImage(false);
      return toast.error("Falha ao enviar imagem: " + error.message);
    }
    if (imagePath) {
      await supabase.storage.from("recipe-images").remove([imagePath]);
    }
    const { data: signed } = await supabase.storage.from("recipe-images").createSignedUrl(path, 3600);
    setImagePath(path);
    setImagePreview(signed?.signedUrl ?? null);
    setUploadingImage(false);
  }

  async function removeImage() {
    if (imagePath) await supabase.storage.from("recipe-images").remove([imagePath]);
    setImagePath(null);
    setImagePreview(null);
  }

  // Composition draft
  const [items, setItems] = useState<DraftItem[]>([]);
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

  // Unit cost lookup for selected ingredients
  const itemKeys = items.map((i) => `${i.item_type}:${i.target_id}`).join("|");
  const { data: unitCosts } = useQuery({
    queryKey: ["draft-item-costs", itemKeys],
    enabled: items.length > 0,
    queryFn: async () => {
      const map: Record<string, number> = {};
      await Promise.all(
        items.map(async (it) => {
          const key = `${it.item_type}:${it.target_id}`;
          const { data } = await supabase.rpc("ingredient_avg_cost_last_30d", { _ingredient_id: it.target_id });
          map[key] = Number(data ?? 0);
        }),
      );
      return map;
    },
  });


  const { data: menuCategories } = useQuery({
    queryKey: ["menu-categories"],
    queryFn: async () => {
      const [{ data: r }, { data: m }] = await Promise.all([
        supabase.from("recipes").select("menu_category").not("menu_category", "is", null),
        (supabase as any).from("menu_products").select("category").not("category", "is", null),
      ]);
      const set = new Set<string>();
      (r ?? []).forEach((x: any) => x.menu_category && set.add(x.menu_category));
      (m ?? []).forEach((x: any) => x.category && set.add(x.category));
      return Array.from(set).sort((a, b) => a.localeCompare(b));
    },
  });

  const selectedBaseUnit = ingredients?.find((i) => i.id === targetId)?.unit ?? "";
  const unitOptions = selectedBaseUnit ? compatibleUnits(selectedBaseUnit) : [];

  useEffect(() => {
    if (selectedBaseUnit) setUnit(selectedBaseUnit);
  }, [selectedBaseUnit]);

  function addDraftItem() {
    if (!targetId || !qty) return toast.error("Selecione um item e a quantidade");
    const converted = convert(Number(qty), unit, selectedBaseUnit);
    if (converted === null) return toast.error(`Unidade ${unit} não é compatível com ${selectedBaseUnit}`);
    const targetName = ingredients?.find((i) => i.id === targetId)?.name ?? "";
    setItems((prev) => [
      ...prev,
      { key: crypto.randomUUID(), item_type: "ingredient", target_id: targetId, target_name: targetName, quantity: converted, unit: selectedBaseUnit },
    ]);
    setTargetId(""); setQty("");
  }

  function removeDraft(key: string) {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }

  async function isCodeTaken(code: string) {
    const c = code.trim();
    if (!c) return false;
    const [{ data: r }, { data: m }] = await Promise.all([
      supabase.from("recipes").select("id").eq("product_code", c).limit(1),
      (supabase as any).from("menu_products").select("id").eq("product_code", c).limit(1),
    ]);
    return (r?.length ?? 0) > 0 || (m?.length ?? 0) > 0;
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return toast.error("Informe o nome");
    if (isOnMenu === "yes" && productCode.trim()) {
      if (await isCodeTaken(productCode)) {
        return toast.error(`Já existe um item no cardápio com o código "${productCode.trim()}".`);
      }
    }
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
      image_url: isOnMenu === "yes" ? imagePath : null,
    }).select("id").single();

    if (error || !recipe) {
      setSaving(false);
      return toast.error(error?.message ?? "Erro ao criar ficha");
    }

    if (items.length > 0) {
      const payload = items.map((it) => ({
        recipe_id: recipe.id,
        item_type: "ingredient" as const,
        ingredient_id: it.target_id,
        sub_recipe_id: null,
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
        name: normalizeName(name),
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
                <CategoryCombobox value={menuCategory} onChange={setMenuCategory} options={menuCategories ?? []} />
              </div>
              <div>
                <Label>Preço de venda atual (R$)</Label>
                <Input type="number" step="0.01" min="0" value={currentPrice} onChange={(e) => setCurrentPrice(e.target.value)} />
              </div>
            </div>
          )}
          {isOnMenu === "yes" && (
            <div>
              <Label>Foto do produto (opcional)</Label>
              <div className="mt-2 flex items-start gap-4">
                {imagePreview ? (
                  <div className="relative">
                    <img src={imagePreview} alt="Prévia" className="h-24 w-24 rounded-lg border object-cover" />
                    <Button type="button" variant="ghost" size="icon" onClick={removeImage} className="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-background border">
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed text-xs text-muted-foreground">Sem foto</div>
                )}
                <div className="flex-1">
                  <Input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploadingImage} />
                  <p className="mt-1 text-xs text-muted-foreground">{uploadingImage ? "Enviando..." : "JPG ou PNG, até 5MB."}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Composição */}
        <div className="space-y-4 rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
          <div>
            <h2 className="font-display text-xl">Composição</h2>
            <p className="text-sm text-muted-foreground">Adicione os insumos que compõem esta ficha.</p>
          </div>

          <div className="space-y-2">
            {items.length === 0 ? (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nenhum item adicionado.</p>
            ) : items.map((it) => {
              const uc = unitCosts?.[`${it.item_type}:${it.target_id}`] ?? 0;
              const line = uc * Number(it.quantity);
              return (
              <div key={it.key} className="flex items-center justify-between gap-3 rounded-lg border bg-background p-3">
                <div className="flex items-center gap-3 min-w-0">
                   <Package className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{it.target_name}</p>
                    <p className="text-xs text-muted-foreground">{it.quantity} {it.unit} · R$ {uc.toFixed(4)}/{it.unit}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium tabular-nums">R$ {line.toFixed(2)}</span>
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeDraft(it.key)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              );
            })}
            {items.length > 0 && (
              <div className="flex justify-end pt-2 text-sm">
                <span className="text-muted-foreground mr-2">Custo total:</span>
                <span className="font-semibold tabular-nums">
                  R$ {items.reduce((s, it) => s + (unitCosts?.[`${it.item_type}:${it.target_id}`] ?? 0) * Number(it.quantity), 0).toFixed(2)}
                </span>
              </div>
            )}
          </div>

          <div className="grid gap-3 rounded-lg border bg-background p-4 sm:grid-cols-12">
            <div className="sm:col-span-8">
              <Label>Insumo</Label>
              <Select value={targetId} onValueChange={(v) => {
                setTargetId(v);
                const ing = ingredients?.find((i) => i.id === v);
                if (ing) setUnit(ing.unit);
              }}>
                <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {(ingredients ?? []).map((i) => <SelectItem key={i.id} value={i.id}>{i.name} ({i.unit})</SelectItem>)}
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

function CategoryCombobox({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: string[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const exists = options.some((o) => o.toLowerCase() === trimmed.toLowerCase());
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" className="w-full justify-between font-normal">
          <span className={cn("truncate", !value && "text-muted-foreground")}>{value || "Selecione ou crie..."}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command>
          <CommandInput placeholder="Buscar categoria..." value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>
              {trimmed ? (
                <button
                  type="button"
                  className="w-full rounded-sm px-2 py-2 text-sm hover:bg-accent text-left"
                  onClick={() => { onChange(trimmed); setOpen(false); setQuery(""); }}
                >
                  + Criar "{trimmed}"
                </button>
              ) : "Nenhuma categoria"}
            </CommandEmpty>
            <CommandGroup>
              {options.map((o) => (
                <CommandItem key={o} value={o} onSelect={() => { onChange(o); setOpen(false); setQuery(""); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === o ? "opacity-100" : "opacity-0")} />
                  {o}
                </CommandItem>
              ))}
              {trimmed && !exists && (
                <CommandItem value={`__create_${trimmed}`} onSelect={() => { onChange(trimmed); setOpen(false); setQuery(""); }}>
                  <Plus className="mr-2 h-4 w-4" /> Criar "{trimmed}"
                </CommandItem>
              )}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

