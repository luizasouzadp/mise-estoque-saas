import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/searchable-select";
import { ArrowLeft, Camera, Image as ImageIcon, Trash2, Loader2, Sparkles, AlertCircle, ZoomIn } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  parseInvoiceImage,
  suggestIngredientMatches,
  saveImportedPurchase,
} from "@/lib/invoice-import.functions";

export const Route = createFileRoute("/_authenticated/purchases/import")({
  validateSearch: (search: Record<string, unknown>) =>
    z.object({ fromOrderReceipt: z.string().optional() }).parse(search),
  component: ImportPurchase,
});

type ReviewItem = {
  key: string;
  raw_text: string;
  ingredient_id: string; // "" if unmatched
  quantity_nota: string;
  unit_nota: string;
  unit_cost_nota: string;
  factor: string; // default 1
  suggestions: Array<{ ingredient_id: string; name: string; unit: string; confidence: number; source: "learned" | "trgm" }>;
  learn_alias: boolean;
};

function ImportPurchase() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const search = Route.useSearch();
  const fromOrderReceipt = search.fromOrderReceipt;
  const parseFn = useServerFn(parseInvoiceImage);
  const suggestFn = useServerFn(suggestIngredientMatches);
  const saveFn = useServerFn(saveImportedPurchase);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [zoomOpen, setZoomOpen] = useState(false);
  const [supplierName, setSupplierName] = useState("");
  const [supplierTaxId, setSupplierTaxId] = useState("");
  const [purchasedAt, setPurchasedAt] = useState(() => {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d.getTime() - tz).toISOString().slice(0, 16);
  });
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [ingredientOptions, setIngredientOptions] = useState<Array<{ id: string; name: string; unit: string }>>([]);
  const [aliasMap, setAliasMap] = useState<Map<string, number>>(new Map()); // key: `${ingId}::${unit_up}` -> factor
  const [saving, setSaving] = useState(false);
  const [existingInvoicePath, setExistingInvoicePath] = useState<string | null>(null);
  const [autoLoading, setAutoLoading] = useState(false);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  // If arriving from an order receipt, download that image and prefill.
  useEffect(() => {
    if (!fromOrderReceipt || existingInvoicePath) return;
    let cancelled = false;
    (async () => {
      setAutoLoading(true);
      try {
        const { data: blob, error } = await supabase.storage
          .from("purchase-invoices")
          .download(fromOrderReceipt);
        if (error || !blob) throw new Error(error?.message || "Falha ao carregar nota");
        if (cancelled) return;
        const name = fromOrderReceipt.split("/").pop() || "nota.jpg";
        const f = new File([blob], name, { type: blob.type || "image/jpeg" });
        setFile(f);
        setExistingInvoicePath(fromOrderReceipt);
        const reader = new FileReader();
        reader.onload = () => !cancelled && setPreview(String(reader.result));
        reader.readAsDataURL(f);
        // Preload supplier from the linked order.
        const { data: ord } = await (supabase as any)
          .from("purchase_orders")
          .select("supplier_name")
          .eq("receipt_image_path", fromOrderReceipt)
          .limit(1)
          .maybeSingle();
        if (!cancelled && ord?.supplier_name) setSupplierName(ord.supplier_name);
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        if (!cancelled) setAutoLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [fromOrderReceipt, existingInvoicePath]);

  const { data: ingredientsData } = useQuery({
    queryKey: ["ingredients"],
    queryFn: async () => {
      const { data } = await supabase.from("ingredients").select("id, name, unit").order("name");
      return data ?? [];
    },
  });

  function fileToDataUrl(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
  }

  function onPickFile(f: File) {
    setFile(f);
    fileToDataUrl(f).then(setPreview);
  }

  const parseMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Escolha uma foto da nota primeiro.");
      const dataUrl = await fileToDataUrl(file);
      const parsed = await parseFn({ data: { imageDataUrl: dataUrl } });
      const suggested = await suggestFn({
        data: { raw_texts: parsed.items.map((i) => i.raw_text) },
      });
      return { parsed, suggested };
    },
    onSuccess: ({ parsed, suggested }) => {
      setSupplierName(parsed.supplier ?? "");
      setSupplierTaxId(parsed.tax_id ?? "");
      // Data da compra = dia do lançamento (agora), ignorando a data da nota.
      setIngredientOptions(suggested.ingredients);
      const am = new Map<string, number>();
      suggested.aliases.forEach((a) => {
        am.set(`${a.ingredient_id}::${a.from_unit.toUpperCase()}`, a.factor);
      });
      setAliasMap(am);
      const reviewItems: ReviewItem[] = parsed.items.map((it, idx) => {
        const sug = suggested.matches[idx]?.suggestions ?? [];
        const top = sug[0];
        const ingredientId = top?.ingredient_id ?? "";
        const unitNota = (it.unit ?? "un").trim();
        let factor = 1;
        if (ingredientId) {
          const aliasKey = `${ingredientId}::${unitNota.toUpperCase()}`;
          const aliasFactor = am.get(aliasKey);
          if (aliasFactor) factor = aliasFactor;
          else {
            const ing = suggested.ingredients.find((g) => g.id === ingredientId);
            if (ing && ing.unit.toUpperCase() === unitNota.toUpperCase()) factor = 1;
          }
        }
        return {
          key: crypto.randomUUID(),
          raw_text: it.raw_text,
          ingredient_id: ingredientId,
          quantity_nota: String(it.quantity ?? 1),
          unit_nota: unitNota,
          unit_cost_nota: String(it.unit_price ?? (it.total && it.quantity ? it.total / it.quantity : 0)),
          factor: String(factor),
          suggestions: sug,
          learn_alias: false,
        };
      });
      setItems(reviewItems);
      toast.success(`${reviewItems.length} item(ns) extraído(s). Confira e salve.`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Sync options once ingredients query resolves (in case suggest ran first with empty list).
  const options = ingredientsData ?? ingredientOptions;

  function updateItem(key: string, patch: Partial<ReviewItem>) {
    setItems((prev) => prev.map((it) => (it.key === key ? { ...it, ...patch } : it)));
  }
  function removeItem(key: string) {
    setItems((prev) => prev.filter((it) => it.key !== key));
  }

  // When user changes ingredient or unit, auto-fill factor from alias map if known.
  function onIngredientChange(item: ReviewItem, newId: string) {
    const aliasFactor = aliasMap.get(`${newId}::${item.unit_nota.toUpperCase()}`);
    let factor = aliasFactor;
    if (!factor) {
      const ing = options.find((o) => o.id === newId);
      factor = ing && ing.unit.toUpperCase() === item.unit_nota.toUpperCase() ? 1 : Number(item.factor) || 1;
    }
    updateItem(item.key, { ingredient_id: newId, factor: String(factor) });
  }
  function onUnitNotaChange(item: ReviewItem, newUnit: string) {
    const aliasFactor = aliasMap.get(`${item.ingredient_id}::${newUnit.toUpperCase()}`);
    let factor = aliasFactor;
    if (!factor && item.ingredient_id) {
      const ing = options.find((o) => o.id === item.ingredient_id);
      factor = ing && ing.unit.toUpperCase() === newUnit.toUpperCase() ? 1 : Number(item.factor) || 1;
    }
    updateItem(item.key, { unit_nota: newUnit, factor: String(factor ?? item.factor) });
  }

  const totalCompra = useMemo(
    () =>
      items.reduce(
        (s, it) => s + (Number(it.quantity_nota) || 0) * (Number(it.unit_cost_nota) || 0),
        0,
      ),
    [items],
  );

  async function submit() {
    const invalid = items.find((it) => !it.ingredient_id);
    if (invalid) return toast.error("Escolha o insumo para todas as linhas ou remova as extras.");
    for (const it of items) {
      if (!(Number(it.quantity_nota) > 0)) return toast.error("Quantidade inválida em uma linha.");
      if (!(Number(it.factor) > 0)) return toast.error("Fator de conversão inválido.");
      if (!(Number(it.unit_cost_nota) >= 0)) return toast.error("Preço unitário inválido.");
    }
    setSaving(true);
    try {
      // 1. Upload image (reuse existing path when coming from an order receipt).
      let invoicePath: string | null = existingInvoicePath;
      if (!invoicePath && file) {
        const { data: prof } = await supabase.from("profiles").select("restaurant_id").maybeSingle();
        if (!prof?.restaurant_id) throw new Error("Restaurante não encontrado");
        const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
        const path = `${prof.restaurant_id}/${crypto.randomUUID()}.${ext || "jpg"}`;
        const { error: upErr } = await supabase.storage.from("purchase-invoices").upload(path, file, {
          contentType: file.type || "image/jpeg",
          upsert: false,
        });
        if (upErr) throw new Error(`Falha no upload da imagem: ${upErr.message}`);
        invoicePath = path;
      }

      // 2. Persist
      const result = await saveFn({
        data: {
          supplier_name: supplierName.trim() || null,
          supplier_tax_id: supplierTaxId.trim() || null,
          purchased_at: new Date(purchasedAt).toISOString(),
          invoice_image_path: invoicePath,
          items: items.map((it) => ({
            ingredient_id: it.ingredient_id,
            raw_text: it.raw_text,
            quantity_nota: Number(it.quantity_nota),
            unit_nota: it.unit_nota.trim() || "un",
            unit_cost_nota: Number(it.unit_cost_nota),
            factor: Number(it.factor),
            learn_alias: it.learn_alias,
          })),
        },
      });

      // 3. If linked to a receipt, mark the pending orders as imported.
      if (existingInvoicePath) {
        await (supabase as any)
          .from("purchase_orders")
          .update({
            import_status: "imported",
            imported_purchase_ids: result?.purchase_ids ?? null,
          })
          .eq("receipt_image_path", existingInvoicePath)
          .eq("import_status", "pending");
      }

      toast.success("Compra registrada! Estoque atualizado.");
      qc.invalidateQueries({ queryKey: ["purchases"] });
      qc.invalidateQueries({ queryKey: ["ingredients"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["purchase-orders-pending-import"] });
      qc.invalidateQueries({ queryKey: ["purchase-notes"] });
      nav({ to: "/purchases" });
    } catch (e) {
      const err = e as Error;
      console.error("[purchases.import] falha ao salvar", err);
      toast.error(err.message || "Falha ao salvar a compra");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-4 md:p-8">
      <Link to="/purchases" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Voltar
      </Link>
      <h1 className="mt-3 font-display text-3xl">Compra por foto da nota</h1>
      <p className="text-sm text-muted-foreground">
        Envie a foto de uma nota fiscal ou cupom. A IA extrai os itens, quantidades e valores e sugere o insumo do seu cadastro. Você confere antes de gravar.
      </p>

      {items.length === 0 && (
        <div className="mt-6 space-y-4 rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
          <div>
            <Label>Foto da nota</Label>
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
                e.target.value = "";
              }}
            />
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPickFile(f);
                e.target.value = "";
              }}
            />
            <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-start">
              <Button type="button" variant="outline" onClick={() => cameraInputRef.current?.click()}>
                <Camera className="mr-2 h-4 w-4" />
                Tirar foto
              </Button>
              <Button type="button" variant="outline" onClick={() => galleryInputRef.current?.click()}>
                <ImageIcon className="mr-2 h-4 w-4" />
                Escolher da galeria
              </Button>
              {file && (
                <div className="text-xs text-muted-foreground self-center">
                  {file.name} · {(file.size / 1024).toFixed(0)} KB
                </div>
              )}
            </div>
            {preview && (
              <button
                type="button"
                onClick={() => setZoomOpen(true)}
                title="Clique para ampliar"
                className="mt-3 group relative block overflow-hidden rounded-lg border transition hover:ring-2 hover:ring-primary"
              >
                <img src={preview} alt="Prévia" className="max-h-80 w-auto" />
                <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/60 px-2 py-1 text-xs text-white opacity-0 transition group-hover:opacity-100">
                  <ZoomIn className="h-3 w-3" /> Ampliar
                </span>
              </button>
            )}
          </div>
          <Button
            type="button"
            onClick={() => parseMut.mutate()}
            disabled={!file || parseMut.isPending}
            className="w-full sm:w-auto"
          >
            {parseMut.isPending ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Lendo nota…</>
            ) : (
              <><Sparkles className="mr-2 h-4 w-4" /> Ler nota com IA</>
            )}
          </Button>
          {parseMut.isError && (
            <p className="text-sm text-destructive">{(parseMut.error as Error).message}</p>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="mt-6 space-y-4">
          <div className="rounded-xl border bg-card p-6 shadow-[var(--shadow-soft)]">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="sm:col-span-2">
                <Label>Fornecedor</Label>
                <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Nome do fornecedor" />
                <p className="mt-1 text-xs text-muted-foreground">Será criado se não existir.</p>
              </div>
              <div>
                <Label>CNPJ (opcional)</Label>
                <Input value={supplierTaxId} onChange={(e) => setSupplierTaxId(e.target.value)} placeholder="Somente dígitos" />
              </div>
              <div className="sm:col-span-3">
                <Label>Data / hora</Label>
                <Input type="datetime-local" value={purchasedAt} onChange={(e) => setPurchasedAt(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
            <h2 className="mb-3 font-semibold">Itens extraídos ({items.length})</h2>
            <div className="space-y-3">
              {items.map((it, idx) => {
                const ing = options.find((o) => o.id === it.ingredient_id);
                const qtyBase = (Number(it.quantity_nota) || 0) * (Number(it.factor) || 0);
                const unitCostBase = Number(it.factor) > 0 ? (Number(it.unit_cost_nota) || 0) / Number(it.factor) : 0;
                const subtotal = (Number(it.quantity_nota) || 0) * (Number(it.unit_cost_nota) || 0);
                const unitMismatch =
                  it.ingredient_id && ing && ing.unit.toUpperCase() !== it.unit_nota.toUpperCase();
                const aliasKnown = it.ingredient_id
                  ? aliasMap.has(`${it.ingredient_id}::${it.unit_nota.toUpperCase()}`)
                  : false;
                const suggestFactorInput = unitMismatch && !aliasKnown;
                return (
                  <div key={it.key} className="rounded-lg border bg-background/50 p-3 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-muted-foreground">Item {idx + 1} · Texto da nota</p>
                        <p className="font-medium text-sm break-words">{it.raw_text}</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => removeItem(it.key)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div>
                      <Label className="text-xs">Insumo</Label>
                      <Select value={it.ingredient_id || "__none__"} onValueChange={(v) => onIngredientChange(it, v === "__none__" ? "" : v)}>
                        <SelectTrigger className={!it.ingredient_id ? "border-destructive" : ""}>
                          <SelectValue placeholder="Escolher insumo…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">— Escolher —</SelectItem>
                          {options.map((o) => (
                            <SelectItem key={o.id} value={o.id}>
                              {o.name} ({o.unit})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {it.suggestions.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1 text-xs">
                          {it.suggestions.slice(0, 3).map((s) => (
                            <button
                              key={s.ingredient_id}
                              type="button"
                              onClick={() => onIngredientChange(it, s.ingredient_id)}
                              className={`rounded-full border px-2 py-0.5 hover:bg-muted ${it.ingredient_id === s.ingredient_id ? "border-primary bg-primary/10" : ""}`}
                              title={s.source === "learned" ? "Aprendido de compras anteriores" : `Similaridade ${Math.round(s.confidence * 100)}%`}
                            >
                              {s.source === "learned" ? "★ " : ""}{s.name} · {Math.round(s.confidence * 100)}%
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <div>
                        <Label className="text-xs">Qtd (nota)</Label>
                        <Input type="number" step="0.001" value={it.quantity_nota} onChange={(e) => updateItem(it.key, { quantity_nota: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">Un. (nota)</Label>
                        <Input value={it.unit_nota} onChange={(e) => onUnitNotaChange(it, e.target.value)} />
                      </div>
                      <div>
                        <Label className="text-xs">Preço un. (R$)</Label>
                        <Input type="number" step="0.001" value={it.unit_cost_nota} onChange={(e) => updateItem(it.key, { unit_cost_nota: e.target.value })} />
                      </div>
                      <div>
                        <Label className="text-xs">
                          Fator ({it.unit_nota || "?"} → {ing?.unit ?? "?"})
                        </Label>
                        <Input
                          type="number"
                          step="0.001"
                          value={it.factor}
                          onChange={(e) => updateItem(it.key, { factor: e.target.value })}
                          className={suggestFactorInput ? "border-amber-500" : ""}
                        />
                      </div>
                    </div>

                    {suggestFactorInput && (
                      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                        <AlertCircle className="mt-0.5 h-3.5 w-3.5 text-amber-600" />
                        <div className="flex-1">
                          Ajuste o fator: <b>1 {it.unit_nota}</b> = <b>{it.factor} {ing?.unit}</b>?
                          <div className="mt-1 flex items-center gap-2">
                            <Switch id={`learn-${it.key}`} checked={it.learn_alias} onCheckedChange={(v) => updateItem(it.key, { learn_alias: !!v })} />
                            <Label htmlFor={`learn-${it.key}`} className="cursor-pointer text-xs font-normal">
                              Memorizar essa embalagem para este insumo
                            </Label>
                          </div>
                        </div>
                      </div>
                    )}
                    {aliasKnown && Number(it.factor) !== 1 && (
                      <p className="text-xs text-muted-foreground">
                        ✓ Conversão conhecida: 1 {it.unit_nota} = {it.factor} {ing?.unit}
                      </p>
                    )}

                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>
                        Estoque: <b className="text-foreground">{qtyBase.toFixed(3)} {ing?.unit ?? "?"}</b>
                        {" · "}
                        Custo un: <b className="text-foreground">R$ {unitCostBase.toFixed(4)} / {ing?.unit ?? "?"}</b>
                      </span>
                      <span>
                        Subtotal: <b className="text-foreground">R$ {subtotal.toFixed(2)}</b>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between rounded-lg bg-secondary p-4">
            <span className="text-sm text-secondary-foreground">Total da compra</span>
            <span className="font-display text-2xl">R$ {totalCompra.toFixed(2)}</span>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => nav({ to: "/purchases" })}>Cancelar</Button>
            <Button onClick={submit} disabled={saving}>{saving ? "Salvando…" : "Registrar compra"}</Button>
          </div>

          
        </div>
      )}
    </div>
  );
}
