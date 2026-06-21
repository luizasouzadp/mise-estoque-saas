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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, BookOpen, Package, Archive, Copy, Check, ChevronsUpDown, Download, ImageIcon } from "lucide-react";
import { cn, normalizeName } from "@/lib/utils";
import { syncRecipeStockIngredient } from "@/lib/recipe-stock";
import { compatibleUnits, convert } from "@/lib/units";
import { duplicateRecipe } from "@/lib/recipes.functions";
import { useServerFn } from "@tanstack/react-start";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/_authenticated/recipes/$id")({
  component: RecipeDetail,
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const UNITS = ["un", "porção", "kg", "g", "L", "ml", "cx", "pct"];

function RecipeDetail() {
  const { id } = Route.useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const dup = useServerFn(duplicateRecipe);
  const [isDuplicating, setIsDuplicating] = useState(false);

  const { data: recipe, isLoading } = useQuery({
    queryKey: ["recipe", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("recipes")
        .select("id, name, description, yield_qty, yield_unit, is_stocked, restaurant_id, is_on_menu, menu_category, current_price, product_code, image_url")
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
            let unitCost = Number(subTotal ?? 0) / subYield;
            if (!unitCost) {
              const { data: mirror } = await supabase.from("ingredients").select("avg_cost, last_cost").eq("source_recipe_id", it.sub_recipe_id).maybeSingle();
              unitCost = Number(mirror?.avg_cost ?? mirror?.last_cost ?? 0);
            }
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

  const totalCost = (items ?? []).reduce((s, it) => s + it.lineCost, 0);
  const unitCost = recipe && Number(recipe.yield_qty) > 0 ? totalCost / Number(recipe.yield_qty) : 0;
  const cmvPercent = recipe?.is_on_menu && recipe.current_price && Number(recipe.current_price) > 0
    ? (unitCost / Number(recipe.current_price)) * 100
    : null;

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
  const [imagePath, setImagePath] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  // Signed URL for displaying recipe image at header
  const { data: headerImageUrl } = useQuery({
    queryKey: ["recipe-image-url", (recipe as any)?.image_url],
    enabled: !!(recipe as any)?.image_url,
    queryFn: async () => {
      const path = (recipe as any).image_url as string;
      const { data } = await supabase.storage.from("recipe-images").createSignedUrl(path, 3600);
      return data?.signedUrl ?? null;
    },
  });

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
    setProductCode((recipe as any).product_code ?? "");
    const existingPath = (recipe as any).image_url ?? null;
    setImagePath(existingPath);
    setImagePreview(headerImageUrl ?? null);
    setEditing(true);
  }

  async function isCodeTaken(code: string) {
    const c = code.trim();
    if (!c) return false;
    const [{ data: r }, { data: m }] = await Promise.all([
      supabase.from("recipes").select("id").eq("product_code", c).neq("id", id).limit(1),
      (supabase as any).from("menu_products").select("id").eq("product_code", c).limit(1),
    ]);
    return (r?.length ?? 0) > 0 || (m?.length ?? 0) > 0;
  }

  async function saveRecipe() {
    if (!recipe) return;
    const newIsStocked = isStocked === "yes";
    const newIsOnMenu = isOnMenu === "yes";
    if (newIsOnMenu && productCode.trim()) {
      if (await isCodeTaken(productCode)) {
        return toast.error(`Já existe um item no cardápio com o código "${productCode.trim()}".`);
      }
    }
    const { error } = await supabase.from("recipes").update({
      name, description: description || null,
      yield_qty: Number(yieldQty) || 1, yield_unit: yieldUnit,
      is_stocked: newIsStocked,
      is_on_menu: newIsOnMenu,
      menu_category: newIsOnMenu ? (menuCategory || null) : null,
      current_price: newIsOnMenu && currentPrice ? Number(currentPrice) : null,
      product_code: newIsOnMenu && productCode ? productCode.trim() : null,
      image_url: newIsOnMenu ? imagePath : null,
    }).eq("id", id);
    if (error) return toast.error(error.message);
    await syncRecipeStockIngredient({
      recipeId: id,
      restaurantId: recipe.restaurant_id,
      isStocked: newIsStocked,
      name: normalizeName(name),
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

  // Custo unitário do item selecionado (para preview ao adicionar)
  const { data: selectedUnitCost } = useQuery({
    queryKey: ["item-unit-cost", itemType, targetId],
    enabled: !!targetId,
    queryFn: async () => {
      if (itemType === "ingredient") {
        const { data } = await supabase.rpc("ingredient_avg_cost_last_30d", { _ingredient_id: targetId });
        return Number(data ?? 0);
      } else {
        const { data: subTotal } = await supabase.rpc("recipe_total_cost", { _recipe_id: targetId, _depth: 0 });
        const r = allRecipes?.find((r) => r.id === targetId);
        const y = Number(r?.yield_unit ? 0 : 0); // placeholder, fetch yield below
        // Buscar yield_qty
        const { data: sub } = await supabase.from("recipes").select("yield_qty").eq("id", targetId).single();
        const yq = Number(sub?.yield_qty ?? 1) || 1;
        let uc = Number(subTotal ?? 0) / yq;
        if (!uc) {
          const { data: mirror } = await supabase.from("ingredients").select("avg_cost, last_cost").eq("source_recipe_id", targetId).maybeSingle();
          uc = Number(mirror?.avg_cost ?? mirror?.last_cost ?? 0);
        }
        return uc;
      }
    },
  });

  const previewQtyBase = (() => {
    if (!qty || !selectedBaseUnit) return null;
    return convert(Number(qty), unit, selectedBaseUnit);
  })();
  const previewLineCost =
    selectedUnitCost != null && previewQtyBase != null ? selectedUnitCost * previewQtyBase : null;

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

  async function fetchImageDataUrl(url: string): Promise<{ dataUrl: string; w: number; h: number } | null> {
    try {
      const res = await fetch(url);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
      });
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => resolve({ w: 1, h: 1 });
        img.src = dataUrl;
      });
      return { dataUrl, w: dims.w, h: dims.h };
    } catch {
      return null;
    }
  }

  async function exportPdf() {
    if (!recipe) return;
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 16;
    const contentW = pageW - margin * 2;
    const bottomLimit = pageH - 18;

    const drawAccentBar = () => {
      doc.setFillColor(17, 24, 39);
      doc.rect(0, 0, pageW, 6, "F");
    };
    drawAccentBar();

    let y = 20;
    const ensureSpace = (needed: number) => {
      if (y + needed > bottomLimit) {
        doc.addPage();
        drawAccentBar();
        y = 20;
      }
    };

    if (headerImageUrl) {
      const img = await fetchImageDataUrl(headerImageUrl);
      if (img) {
        const targetH = 70;
        const ratio = img.w / img.h;
        let drawW = targetH * ratio;
        let drawH = targetH;
        if (drawW > contentW) { drawW = contentW; drawH = contentW / ratio; }
        ensureSpace(drawH + 6);
        const x = (pageW - drawW) / 2;
        const fmt = img.dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
        doc.addImage(img.dataUrl, fmt, x, y, drawW, drawH, undefined, "FAST");
        y += drawH + 8;
      }
    }

    doc.setFont("helvetica", "bold");
    doc.setTextColor(17, 24, 39);
    doc.setFontSize(24);
    const titleLines = doc.splitTextToSize(recipe.name, contentW);
    const titleLineH = 9;
    ensureSpace(titleLines.length * titleLineH + 2);
    doc.text(titleLines, margin, y);
    y += titleLines.length * titleLineH;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const yieldText = `Rendimento  ·  ${Number(recipe.yield_qty)} ${recipe.yield_unit}`;
    const pillW = Math.min(doc.getTextWidth(yieldText) + 8, contentW);
    ensureSpace(12);
    doc.setFillColor(243, 244, 246);
    doc.roundedRect(margin, y - 4, pillW, 7, 2, 2, "F");
    doc.setTextColor(55, 65, 81);
    doc.text(yieldText, margin + 4, y + 1);
    y += 10;

    if (recipe.description) {
      doc.setTextColor(75, 85, 99);
      doc.setFontSize(10.5);
      const descLineH = 5;
      const descLines = doc.splitTextToSize(recipe.description, contentW);
      for (const line of descLines) {
        ensureSpace(descLineH);
        doc.text(line, margin, y);
        y += descLineH;
      }
      y += 3;
    }

    ensureSpace(14);
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 6;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(17, 24, 39);
    doc.text("Composição", margin, y);
    y += 2;

    autoTable(doc, {
      startY: y + 2,
      head: [["Item", "Quantidade", "Unidade"]],
      body: (items ?? []).map((it) => [it.name, String(Number(it.quantity)), it.unit]),
      theme: "plain",
      styles: { fontSize: 10.5, cellPadding: 3.5, textColor: [31, 41, 55], overflow: "linebreak" },
      headStyles: {
        fillColor: [17, 24, 39],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        halign: "left",
      },
      alternateRowStyles: { fillColor: [249, 250, 251] },
      columnStyles: {
        0: { cellWidth: "auto" },
        1: { halign: "right", cellWidth: 32 },
        2: { halign: "left", cellWidth: 26 },
      },
      margin: { left: margin, right: margin, top: 20, bottom: 18 },
      didDrawPage: () => { drawAccentBar(); },
    });

    const pages = doc.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      doc.setPage(p);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      doc.setTextColor(156, 163, 175);
      doc.text(
        `Ficha técnica · ${new Date().toLocaleDateString("pt-BR")}`,
        margin,
        pageH - 8,
      );
      doc.text(`${p} / ${pages}`, pageW - margin, pageH - 8, { align: "right" });
    }

    doc.save(`${recipe.name.replace(/[^a-z0-9-_ ]/gi, "_")}.pdf`);
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
            {headerImageUrl && (
              <div className="mb-4 overflow-hidden rounded-lg border bg-muted">
                <img src={headerImageUrl} alt={recipe.name} className="h-48 w-full object-cover sm:h-64" />
              </div>
            )}
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
              <div className="flex gap-2 flex-wrap justify-end">
                <Button variant="outline" size="sm" onClick={exportPdf}>
                  <Download className="mr-1 h-4 w-4" /> Exportar PDF
                </Button>
                <Button variant="outline" size="sm" onClick={startEdit}>Editar</Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isDuplicating}
                  onClick={async () => {
                    if (isDuplicating) return;
                    setIsDuplicating(true);
                    try {
                      const res = await dup({ data: { recipeId: id } });
                      toast.success("Ficha duplicada!");
                      qc.invalidateQueries({ queryKey: ["recipes"] });
                      qc.invalidateQueries({ queryKey: ["ingredients"] });
                      nav({ to: "/recipes/$id", params: { id: res.id } });
                    } catch (err: any) {
                      toast.error(err?.message || "Erro ao duplicar");
                    } finally {
                      setIsDuplicating(false);
                    }
                  }}
                >
                  <Copy className="mr-1 h-4 w-4" /> {isDuplicating ? "Duplicando..." : "Duplicar"}
                </Button>
                <Button variant="ghost" size="sm" onClick={deleteRecipe}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
            <div className={`mt-4 grid gap-4 ${recipe.is_on_menu ? "sm:grid-cols-2 md:grid-cols-4" : "sm:grid-cols-3"}`}>
              <Stat label="Rendimento" value={`${Number(recipe.yield_qty)} ${recipe.yield_unit}`} />
              <Stat label="Custo total" value={BRL.format(totalCost)} />
              <Stat label={`Custo por ${recipe.yield_unit}`} value={BRL.format(unitCost)} highlight />
              {recipe.is_on_menu && (
                <Stat
                  label="CMV"
                  value={cmvPercent != null ? `${cmvPercent.toFixed(1)}%` : "—"}
                  highlight
                />
              )}
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
                    <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-dashed text-muted-foreground">
                      <ImageIcon className="h-6 w-6" />
                    </div>
                  )}
                  <div className="flex-1">
                    <Input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploadingImage} />
                    <p className="mt-1 text-xs text-muted-foreground">{uploadingImage ? "Enviando..." : "JPG ou PNG, até 5MB."}</p>
                  </div>
                </div>
              </div>
            )}
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
          <div className="sm:col-span-12 flex items-center justify-between gap-3">
            {targetId && selectedUnitCost != null ? (
              <p className="text-xs text-muted-foreground">
                Custo: <span className="font-medium text-foreground">{BRL.format(selectedUnitCost)}</span> / {selectedBaseUnit || "—"}
                {previewLineCost != null && (
                  <> · Total da linha: <span className="font-semibold text-foreground">{BRL.format(previewLineCost)}</span></>
                )}
              </p>
            ) : <span />}
            <Button type="submit" disabled={adding}><Plus className="mr-2 h-4 w-4" /> Adicionar</Button>
          </div>
        </form>
      </div>

      {editing && (
        <div className="sticky bottom-4 z-10 flex justify-end gap-2 rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
          <Button variant="ghost" onClick={() => setEditing(false)}>Cancelar</Button>
          <Button onClick={saveRecipe}>Salvar ficha técnica</Button>
        </div>
      )}
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
