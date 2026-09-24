import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getMyRestaurantId } from "@/lib/profile";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/searchable-select";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  Search,
  Package,
  Upload,
  FileSpreadsheet,
  AlertCircle,
  Download,
  History,
  X,
} from "lucide-react";
import { normalizeName } from "@/lib/utils";
import { loadStockHistory, parseLocal, stockAt } from "@/lib/stock-history";

export const Route = createFileRoute("/_authenticated/ingredients/")({
  component: IngredientsList,
});

function parseBool(v: unknown): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  return ["sim", "s", "yes", "y", "true", "1", "x"].includes(s);
}
function parseNum(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  let s = String(v).trim();
  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  if (hasComma && hasDot) {
    // "1.234,56" → "1234.56"
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    // "12,50" → "12.50"
    s = s.replace(",", ".");
  }
  s = s.replace(/[^\d.-]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

const brl = (n: number) =>
  n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

type FieldKey = "name" | "unit" | "category" | "stock" | "minStock" | "cost" | "cmv";

const FIELD_LABELS: Record<FieldKey, string> = {
  name: "Nome do insumo",
  unit: "Unidade",
  category: "Categoria",
  stock: "Estoque atual",
  minStock: "Estoque mínimo",
  cost: "Custo",
  cmv: "Compõe CMV",
};

const FIELD_SYNONYMS: Record<FieldKey, string[]> = {
  name: ["nome", "insumo", "produto", "descricao", "item"],
  unit: ["unidade", "un", "medida"],
  category: ["categoria", "grupo"],
  stock: ["estoque atual", "estoque", "quantidade", "qtd", "saldo"],
  minStock: ["estoque minimo", "minimo", "min"],
  cost: ["custo unitario", "custo", "preco", "valor"],
  cmv: ["compoe cmv", "cmv"],
};

function normKey(s: string) {
  return String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function autoDetectColumns(headers: string[]): Record<FieldKey, number | null> {
  const normed = headers.map(normKey);
  const map = {} as Record<FieldKey, number | null>;
  const used = new Set<number>();
  const fields = Object.keys(FIELD_SYNONYMS) as FieldKey[];
  for (const field of fields) {
    let found: number | null = null;
    for (let i = 0; i < normed.length; i++) {
      if (used.has(i)) continue;
      if (FIELD_SYNONYMS[field].includes(normed[i])) { found = i; break; }
    }
    map[field] = found;
    if (found != null) used.add(found);
  }
  for (const field of fields) {
    if (map[field] != null) continue;
    let found: number | null = null;
    for (let i = 0; i < normed.length; i++) {
      if (used.has(i)) continue;
      if (FIELD_SYNONYMS[field].some((syn) => normed[i].includes(syn))) { found = i; break; }
    }
    map[field] = found;
    if (found != null) used.add(found);
  }
  return map;
}

type PreviewRow = {
  key: string;
  name: string;
  unit: string;
  category: string | null;
  stock: number | null;
  minStock: number | null;
  cost: number | null;
  cmv: boolean;
  existingId: string | null;
  currentStock: number | null;
};

function IngredientsList() {
  const [q, setQ] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [selectedCats, setSelectedCats] = useState<string[]>([]);
  const [refDate, setRefDate] = useState("");

  const [importing, setImporting] = useState(false);
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importStep, setImportStep] = useState<"start" | "preview">("start");
  const [importHeaders, setImportHeaders] = useState<string[]>([]);
  const [importRows, setImportRows] = useState<unknown[][]>([]);
  const [colMap, setColMap] = useState<Record<FieldKey, number | null>>({
    name: null, unit: null, category: null, stock: null, minStock: null, cost: null, cmv: null,
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["ingredients", "history"],
    queryFn: loadStockHistory,
  });

  const ingredients = useMemo(() => data?.ingredients ?? [], [data]);
  const moves = useMemo(() => data?.moves ?? [], [data]);

  const categories = useMemo(
    () =>
      Array.from(new Set(ingredients.map((i) => i.category).filter(Boolean) as string[])).sort(
        (a, b) => a.localeCompare(b, "pt-BR"),
      ),
    [ingredients],
  );

  const ingredientByName = useMemo(() => {
    const m = new Map<string, { id: string; current_stock: number; unit: string }>();
    for (const ing of ingredients) m.set(normKey(ing.name), ing);
    return m;
  }, [ingredients]);

  const cutoff = useMemo(() => (refDate ? parseLocal(refDate, true) : null), [refDate]);

  const stockMap = useMemo(() => {
    if (!cutoff) return null;
    return stockAt(ingredients, moves, cutoff);
  }, [cutoff, ingredients, moves]);

  const stockOf = (id: string, current: number) =>
    stockMap ? (stockMap.get(id) ?? 0) : Number(current);

  const filtered = useMemo(
    () =>
      ingredients.filter((i) => {
        if (!showInactive && i.is_active === false) return false;
        if (selectedCats.length > 0 && !selectedCats.includes(i.category ?? "Sem categoria"))
          return false;
        if (!q) return true;
        const term = q.toLowerCase();
        return (
          i.name.toLowerCase().includes(term) || (i.category ?? "").toLowerCase().includes(term)
        );
      }),
    [ingredients, showInactive, selectedCats, q],
  );

  const inactiveCount = ingredients.filter((i) => i.is_active === false).length;

  const summary = useMemo(() => {
    let value = 0;
    let below = 0;
    let zeroed = 0;
    for (const i of filtered) {
      const stock = stockOf(i.id, i.current_stock);
      value += stock * Number(i.avg_cost ?? 0);
      if (stock <= 0) zeroed++;
      else if (Number(i.min_stock ?? 0) > 0 && stock <= Number(i.min_stock)) below++;
    }
    return { items: filtered.length, value, below, zeroed };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, stockMap]);

  const hasFilters = selectedCats.length > 0 || !!refDate || !!q;

  function toggleCat(c: string) {
    setSelectedCats((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  function clearFilters() {
    setSelectedCats([]);
    setRefDate("");
    setQ("");
  }


  function handleExport() {
    const wb = XLSX.utils.book_new();

    const itemsSheet = filtered.map((i) => {
      const stock = stockOf(i.id, i.current_stock);
      const min = Number(i.min_stock ?? 0);
      return {
        Insumo: i.name,
        Categoria: i.category ?? "",
        Unidade: i.unit,
        Estoque: Number(stock.toFixed(3)),
        "Custo médio": Number(Number(i.avg_cost ?? 0).toFixed(4)),
        "Valor total": Number((stock * Number(i.avg_cost ?? 0)).toFixed(2)),
        "Estoque mínimo": min,
        Situação:
          i.is_active === false
            ? "Inativo"
            : stock <= 0
              ? "Sem estoque"
              : min > 0 && stock <= min
                ? "Baixo"
                : "OK",
      };
    });

    const summarySheet = [
      { Indicador: "Categorias", Valor: selectedCats.length ? selectedCats.join(", ") : "Todas" },
      { Indicador: "Data de referência", Valor: refDate || "Hoje" },
      { Indicador: "Busca", Valor: q || "-" },
      { Indicador: "Itens", Valor: summary.items },
      { Indicador: "Valor em estoque (R$)", Valor: Number(summary.value.toFixed(2)) },
      { Indicador: "Abaixo do mínimo", Valor: summary.below },
      { Indicador: "Zerados", Valor: summary.zeroed },
    ];

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summarySheet), "Resumo");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(itemsSheet), "Insumos");

    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `estoque-${stamp}.xlsx`);
    toast.success("Exportação gerada");
  }

  async function handleFileSelected(file: File) {
    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
      if (!rows.length) throw new Error("Planilha vazia");

      const headerRow = (rows[0] ?? []).map((h, idx) => {
        const s = String(h ?? "").trim();
        return s || `Coluna ${idx + 1}`;
      });
      const dataRows = rows.slice(1).filter((r) => Array.isArray(r) && r.some((c) => String(c ?? "").trim() !== ""));
      if (!dataRows.length) throw new Error("Planilha sem dados (só cabeçalho)");

      setImportHeaders(headerRow);
      setImportRows(dataRows);
      setColMap(autoDetectColumns(headerRow));
      setImportStep("preview");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao ler o arquivo");
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const importPreview: PreviewRow[] = useMemo(() => {
    if (colMap.name == null || !importRows.length) return [];
    const list: PreviewRow[] = [];
    const indexByKey = new Map<string, number>();
    for (const r of importRows) {
      const rawName = String(r[colMap.name as number] ?? "").trim();
      if (!rawName) continue;
      const name = normalizeName(rawName);
      const key = normKey(name);
      const unit = colMap.unit != null ? String(r[colMap.unit] ?? "").trim() : "";
      const category = colMap.category != null ? String(r[colMap.category] ?? "").trim() : "";
      const stock = colMap.stock != null && String(r[colMap.stock] ?? "").trim() !== "" ? parseNum(r[colMap.stock]) : null;
      const minStock = colMap.minStock != null && String(r[colMap.minStock] ?? "").trim() !== "" ? parseNum(r[colMap.minStock]) : null;
      const cost = colMap.cost != null && String(r[colMap.cost] ?? "").trim() !== "" ? parseNum(r[colMap.cost]) : null;
      const cmv = colMap.cmv != null ? parseBool(r[colMap.cmv]) : false;
      const existing = ingredientByName.get(key);

      const dupIdx = indexByKey.get(key);
      if (dupIdx != null) {
        const prev = list[dupIdx];
        if (unit) prev.unit = unit;
        if (category) prev.category = category;
        if (stock != null) prev.stock = stock;
        if (minStock != null) prev.minStock = minStock;
        if (cost != null) prev.cost = cost;
        if (colMap.cmv != null) prev.cmv = cmv;
        continue;
      }
      indexByKey.set(key, list.length);
      list.push({
        key,
        name,
        unit: unit || existing?.unit || "un",
        category: category || null,
        stock,
        minStock,
        cost,
        cmv,
        existingId: existing?.id ?? null,
        currentStock: existing ? Number(existing.current_stock) : null,
      });
    }
    return list;
  }, [importRows, colMap, ingredientByName]);

  const importCounts = useMemo(() => {
    const toCreate = importPreview.filter((p) => !p.existingId).length;
    const toUpdate = importPreview.filter(
      (p) => p.existingId && p.stock != null && Number(p.stock.toFixed(4)) !== Number((p.currentStock ?? 0).toFixed(4)),
    ).length;
    return { toCreate, toUpdate };
  }, [importPreview]);

  function resetImport() {
    setImportDialogOpen(false);
    setImportStep("start");
    setImportHeaders([]);
    setImportRows([]);
    setColMap({ name: null, unit: null, category: null, stock: null, minStock: null, cost: null, cmv: null });
  }

  async function confirmImport() {
    if (importPreview.length === 0) return;
    setImporting(true);
    try {
      const restaurantId = await getMyRestaurantId();
      if (!restaurantId) throw new Error("Restaurante não encontrado");

      const toCreate = importPreview.filter((p) => !p.existingId);
      const toUpdate = importPreview.filter(
        (p) => p.existingId && p.stock != null && Number(p.stock.toFixed(4)) !== Number((p.currentStock ?? 0).toFixed(4)),
      );

      if (toCreate.length > 0) {
        const payload = toCreate.map((p) => {
          const cost = p.cost ?? 0;
          return {
            restaurant_id: restaurantId,
            name: p.name,
            unit: p.unit || "un",
            category: p.category,
            current_stock: p.stock ?? 0,
            min_stock: p.minStock ?? 0,
            avg_cost: cost,
            last_cost: cost,
            composes_cmv: p.cmv,
          };
        });
        const { error } = await supabase.from("ingredients").insert(payload);
        if (error) throw error;
      }

      if (toUpdate.length > 0) {
        const movRows = toUpdate.map((p) => {
          const diff = Number((Number(p.stock) - Number(p.currentStock ?? 0)).toFixed(4));
          return {
            restaurant_id: restaurantId,
            ingredient_id: p.existingId as string,
            type: (diff > 0 ? "in" : "out") as "in" | "out",
            quantity: Math.abs(diff),
            reason: "Importação de estoque",
            occurred_at: new Date().toISOString(),
          };
        }).filter((m) => m.quantity > 0);
        if (movRows.length > 0) {
          const { error } = await supabase.from("stock_movements").insert(movRows);
          if (error) throw error;
        }
      }

      toast.success(`${toCreate.length} insumo(s) criado(s), ${toUpdate.length} atualizado(s)`);
      qc.invalidateQueries({ queryKey: ["ingredients"] });
      resetImport();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Falha ao importar");
    } finally {
      setImporting(false);
    }
  }


  return (
    <div className="mx-auto max-w-6xl p-4 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div>
          <h1 className="font-display text-3xl">Insumos</h1>
          <p className="text-sm text-muted-foreground">Catálogo do seu restaurante.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelected(f);
            }}
          />
          <Button variant="outline" className="flex-1 sm:flex-none" onClick={handleExport} disabled={isLoading}>
            <Download className="mr-2 h-4 w-4" /> Exportar estoque
          </Button>
          <Button variant="outline" className="flex-1 sm:flex-none" disabled={importing} onClick={() => setImportDialogOpen(true)}>
            <Upload className="mr-2 h-4 w-4" /> {importing ? "Importando..." : "Importar estoque"}
          </Button>
          <Button asChild className="flex-1 sm:flex-none">
            <Link to="/ingredients/new"><Plus className="mr-2 h-4 w-4" /> Novo insumo</Link>
          </Button>
        </div>
      </div>

      {/* Resumo */}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
          <div className="text-xs text-muted-foreground">
            Valor em estoque {refDate && <span className="text-primary">· em {refDate.split("-").reverse().join("/")}</span>}
          </div>
          <div className="font-display text-2xl">{brl(summary.value)}</div>
          <div className="mt-1 text-xs text-muted-foreground">estoque × custo médio</div>
        </div>
        <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
          <div className="text-xs text-muted-foreground">Itens</div>
          <div className="font-display text-2xl">{summary.items}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {summary.below} abaixo do mínimo · {summary.zeroed} zerados
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="mt-4 rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">
              Categorias {selectedCats.length > 0 && <span className="text-primary">({selectedCats.length} selecionadas)</span>}
            </label>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setSelectedCats([])}
                className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${selectedCats.length === 0 ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
              >
                Todas
              </button>
              {categories.map((c) => {
                const on = selectedCats.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggleCat(c)}
                    className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${on ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="sm:w-48">
            <label className="mb-1 block text-xs text-muted-foreground">Estoque na data</label>
            <Input type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
          </div>
        </div>
        {hasFilters && (
          <div className="mt-3 flex items-center justify-between gap-2">
            {refDate ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
                <History className="h-3.5 w-3.5" /> Visão histórica de {refDate.split("-").reverse().join("/")}
              </span>
            ) : <span />}
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="mr-1 h-3.5 w-3.5" /> Limpar filtros
            </Button>
          </div>
        )}
      </div>


      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou categoria..." className="pl-10" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <label className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Mostrar inativos{inactiveCount > 0 && <span className="text-xs text-muted-foreground">({inactiveCount})</span>}
        </label>
      </div>

      <div className="mt-6">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Carregando...</p>
        ) : filtered.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((i) => {
              const cur = stockOf(i.id, i.current_stock);
              const min = Number(i.min_stock);
              const out = cur <= 0;
              const low = !out && min > 0 && cur <= min;
              const pct = min > 0 ? Math.min(100, (cur / min) * 100) : 100;
              const inactive = i.is_active === false;
              return (
                <Link
                  key={i.id}
                  to="/ingredients/$id"
                  params={{ id: i.id }}
                  className={`group rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)] transition hover:border-primary ${inactive ? "opacity-60" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold group-hover:text-primary">{i.name}</h3>
                      {i.category && <p className="text-xs text-muted-foreground">{i.category}</p>}
                    </div>
                    {inactive ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">inativo</span>
                    ) : out ? (
                      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">sem estoque</span>
                    ) : low ? (
                      <span className="rounded-full bg-[color:var(--color-warning)]/15 px-2 py-0.5 text-xs font-medium text-[color:var(--color-warning)]">baixo</span>
                    ) : null}
                  </div>
                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <div className="font-display text-2xl">{cur.toFixed(2)}</div>
                      <div className="text-xs text-muted-foreground">{i.unit} {min > 0 && <>· mín {min.toFixed(2)}</>}</div>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>R$ {Number(i.avg_cost).toFixed(2)}</div>
                      <div>custo médio</div>
                    </div>
                  </div>
                  {min > 0 && (
                    <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={`h-full transition-all ${out ? "bg-destructive" : low ? "bg-[color:var(--color-warning)]" : "bg-primary"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  )}
                </Link>
              );
            })}
          </div>

        )}
      </div>

      <Dialog open={importDialogOpen} onOpenChange={(o) => (o ? setImportDialogOpen(true) : resetImport())}>
        <DialogContent className={importStep === "preview" ? "max-w-3xl" : "max-w-xl"}>
          {importStep === "start" ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                  Importar estoque via Excel
                </DialogTitle>
                <DialogDescription>
                  Envie a planilha com a primeira linha de cabeçalho. Na próxima tela você confere uma prévia,
                  ajusta qual coluna é cada informação e só então confirma a importação.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="rounded-lg border bg-muted/50 p-3 text-sm">
                  <p className="font-medium mb-1">Colunas que o sistema reconhece</p>
                  <p className="text-muted-foreground">
                    Nome do insumo (obrigatória), Unidade, Categoria, Estoque atual, Estoque mínimo, Custo e Compõe CMV.
                    A ordem das colunas não importa — você escolhe qual é qual na próxima tela.
                  </p>
                </div>

                <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-sm dark:border-yellow-900 dark:bg-yellow-950">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-700 dark:text-yellow-400" />
                  <div className="text-yellow-800 dark:text-yellow-200">
                    <p className="font-medium">Como funciona</p>
                    <ul className="mt-1 list-disc pl-4 space-y-0.5">
                      <li>Se o nome já existir num insumo cadastrado, só o <strong>estoque</strong> dele é atualizado.</li>
                      <li>Se o nome for novo, um insumo é <strong>criado</strong> com os dados da planilha.</li>
                      <li>Valores numéricos podem usar vírgula ou ponto como separador decimal.</li>
                      <li>Formatos aceitos: <strong>.xlsx, .xls, .csv</strong></li>
                    </ul>
                  </div>
                </div>
              </div>

              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={resetImport}>Cancelar</Button>
                <Button onClick={() => fileRef.current?.click()} disabled={importing}>
                  <Upload className="mr-2 h-4 w-4" /> {importing ? "Lendo arquivo..." : "Selecionar arquivo"}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5 text-primary" />
                  Prévia da importação
                </DialogTitle>
                <DialogDescription>
                  Confira o que cada coluna da planilha representa e revise os itens antes de confirmar.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {(Object.keys(FIELD_LABELS) as FieldKey[]).map((field) => (
                  <div key={field}>
                    <Label className="text-xs">
                      {FIELD_LABELS[field]}{field === "name" && <span className="text-destructive"> *</span>}
                    </Label>
                    <Select
                      value={colMap[field] != null ? String(colMap[field]) : "__none__"}
                      onValueChange={(v) => setColMap((prev) => ({ ...prev, [field]: v === "__none__" ? null : Number(v) }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Não usar" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Não usar</SelectItem>
                        {importHeaders.map((h, idx) => (
                          <SelectItem key={idx} value={String(idx)}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>

              {colMap.name == null ? (
                <p className="text-sm text-destructive">Escolha qual coluna é o nome do insumo para ver a prévia.</p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-2 text-sm">
                    <Badge variant="secondary">{importCounts.toCreate} novo(s) insumo(s)</Badge>
                    <Badge variant="secondary">{importCounts.toUpdate} atualização(ões) de estoque</Badge>
                    <Badge variant="outline">{importPreview.length} linha(s) no total</Badge>
                  </div>
                  <div className="max-h-72 overflow-y-auto rounded-md border">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-card">
                        <tr className="border-b">
                          <th className="text-left py-1.5 px-2 font-semibold">Insumo</th>
                          <th className="text-left py-1.5 px-2 font-semibold">Unidade</th>
                          <th className="text-left py-1.5 px-2 font-semibold">Categoria</th>
                          <th className="text-left py-1.5 px-2 font-semibold">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="text-muted-foreground">
                        {importPreview.map((p) => {
                          const changed = p.existingId && p.stock != null && Number(p.stock.toFixed(4)) !== Number((p.currentStock ?? 0).toFixed(4));
                          return (
                            <tr key={p.key} className="border-b border-border/50">
                              <td className="py-1.5 px-2 text-foreground">{p.name}</td>
                              <td className="py-1.5 px-2">{p.unit}</td>
                              <td className="py-1.5 px-2">{p.category ?? "—"}</td>
                              <td className="py-1.5 px-2">
                                {!p.existingId ? (
                                  <span className="text-success dark:text-success">Novo insumo</span>
                                ) : changed ? (
                                  <span>Estoque: {p.currentStock} → {p.stock}</span>
                                ) : (
                                  <span>Sem alteração</span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <DialogFooter className="pt-2">
                <Button variant="outline" onClick={() => setImportStep("start")}>Voltar</Button>
                <Button onClick={confirmImport} disabled={importing || colMap.name == null || importPreview.length === 0}>
                  {importing ? "Importando..." : `Confirmar (${importCounts.toCreate} novos, ${importCounts.toUpdate} atualizações)`}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border-2 border-dashed bg-card/50 p-12 text-center">
      <Package className="mx-auto h-10 w-10 text-muted-foreground" />
      <h3 className="mt-4 font-semibold">Nenhum insumo ainda</h3>
      <p className="mt-1 text-sm text-muted-foreground">Comece cadastrando seu primeiro item.</p>
      <Button asChild className="mt-4">
        <Link to="/ingredients/new"><Plus className="mr-2 h-4 w-4" /> Novo insumo</Link>
      </Button>
    </div>
  );
}
