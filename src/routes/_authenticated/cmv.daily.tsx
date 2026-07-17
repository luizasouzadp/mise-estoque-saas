import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import * as XLSX from "xlsx";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { ArrowLeft, Plus, Trash2, AlertTriangle, TrendingDown, CheckCircle2 } from "lucide-react";
import {
  createDailySalesReport,
  deleteDailySalesReport,
} from "@/lib/daily-sales.functions";

export const Route = createFileRoute("/_authenticated/cmv/daily")({
  component: DailySalesPage,
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const QTY = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });

type DailyReport = {
  id: string;
  sales_date: string;
  file_name: string | null;
  total_revenue: number;
  total_quantity: number;
  mapped_count: number;
  unmapped_count: number;
  created_at: string;
};

type ProjectedRow = {
  ingredient_id: string;
  ingredient_name: string;
  unit: string;
  current_stock: number;
  min_stock: number;
  projected_stock: number;
  anchor_at: string;
  days_since_anchor: number;
  consumed_since_anchor: number;
  status: "zerado" | "abaixo_minimo" | "proximo_minimo" | "ok";
};

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatBR(s: string) {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

function DailySalesPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const { data: reports } = useQuery<DailyReport[]>({
    queryKey: ["daily-sales-reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("daily_sales_reports")
        .select("id, sales_date, file_name, total_revenue, total_quantity, mapped_count, unmapped_count, created_at")
        .order("sales_date", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data ?? []) as DailyReport[];
    },
  });

  const { data: projected, isLoading: projLoading } = useQuery<ProjectedRow[]>({
    queryKey: ["projected-stock-status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("projected_stock_status");
      if (error) throw error;
      const rows = ((data ?? []) as unknown[]) as ProjectedRow[];
      // Order: zerado, abaixo, próximo, ok
      const order = { zerado: 0, abaixo_minimo: 1, proximo_minimo: 2, ok: 3 };
      return rows.sort((a, b) => order[a.status] - order[b.status]);
    },
  });

  const del = useServerFn(deleteDailySalesReport);
  async function remove(id: string, dateLabel: string) {
    if (!confirm(`Excluir vendas de ${dateLabel}? Isso também remove o consumo estimado desse dia.`)) return;
    try {
      await del({ data: { id } });
      toast.success("Excluído");
      qc.invalidateQueries({ queryKey: ["daily-sales-reports"] });
      qc.invalidateQueries({ queryKey: ["projected-stock-status"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const alertRows = (projected ?? []).filter((r) => r.status !== "ok");
  const zeroed = alertRows.filter((r) => r.status === "zerado");
  const below = alertRows.filter((r) => r.status === "abaixo_minimo");
  const near = alertRows.filter((r) => r.status === "proximo_minimo");

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-4 md:p-8">
      <div>
        <Link to="/cmv" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary">
          <ArrowLeft className="mr-1 h-4 w-4" /> Voltar ao CMV
        </Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl">Vendas diárias & alerta de compra</h1>
            <p className="text-sm text-muted-foreground">
              Suba as vendas de cada dia para atualizar o consumo estimado dos insumos e
              antecipar compras emergenciais antes da próxima contagem.
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-1" /> Enviar vendas do dia</Button>
            </DialogTrigger>
            <NewDailyReportDialog onDone={() => {
              setOpen(false);
              qc.invalidateQueries({ queryKey: ["daily-sales-reports"] });
              qc.invalidateQueries({ queryKey: ["projected-stock-status"] });
            }} />
          </Dialog>
        </div>
      </div>

      {/* Alerta de compra emergencial */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Alerta de compra emergencial
          </h2>
          <span className="text-xs text-muted-foreground">
            Estoque projetado = último saldo real (última contagem de inventário) menos consumo estimado dos dias enviados.
          </span>
        </div>

        {projLoading ? (
          <div className="rounded-lg border p-6 text-sm text-muted-foreground">Calculando…</div>
        ) : alertRows.length === 0 ? (
          <div className="rounded-lg border border-emerald-600/40 bg-emerald-50/40 p-6 text-sm text-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-300 flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4" />
            Nenhum insumo em risco no momento — todos com estoque projetado acima do mínimo.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            <SummaryCard tone="destructive" label="Zerados" count={zeroed.length} desc="Estoque projetado ≤ 0" />
            <SummaryCard tone="destructive" label="Abaixo do mínimo" count={below.length} desc="Comprar já" />
            <SummaryCard tone="warning" label="Próximos do mínimo" count={near.length} desc="Menos de 15% de folga" />
          </div>
        )}

        {alertRows.length > 0 && (
          <div className="rounded-xl border bg-card overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Insumo</TableHead>
                  <TableHead className="text-right">Estoque atual</TableHead>
                  <TableHead className="text-right">Consumo estimado</TableHead>
                  <TableHead className="text-right">Projetado</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                  <TableHead className="text-right">Dias desde contagem</TableHead>
                  <TableHead></TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alertRows.map((r) => (
                  <TableRow
                    key={r.ingredient_id}
                    className="cursor-pointer hover:bg-secondary/40"
                    onClick={() => nav({ to: "/ingredients/$id", params: { id: r.ingredient_id } })}
                  >
                    <TableCell className="font-medium">{r.ingredient_name}</TableCell>
                    <TableCell className="text-right">{QTY.format(Number(r.current_stock))} {r.unit}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      −{QTY.format(Number(r.consumed_since_anchor))} {r.unit}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${r.status === "zerado" ? "text-destructive" : r.status === "abaixo_minimo" ? "text-destructive" : "text-amber-600"}`}>
                      {QTY.format(Number(r.projected_stock))} {r.unit}
                    </TableCell>
                    <TableCell className="text-right">{QTY.format(Number(r.min_stock))} {r.unit}</TableCell>
                    <TableCell className="text-right">{r.days_since_anchor}d</TableCell>
                    <TableCell><StatusBadge status={r.status} /></TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm" onClick={(e) => e.stopPropagation()}>
                        <Link to="/purchases/new">Comprar</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Histórico de uploads diários */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Últimos dias enviados</h2>
        <div className="rounded-xl border bg-card">
          {!reports || reports.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              Nenhum upload diário ainda. Comece enviando as vendas do dia.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Arquivo</TableHead>
                  <TableHead className="text-right">Itens vendidos</TableHead>
                  <TableHead className="text-right">Faturamento</TableHead>
                  <TableHead className="text-right">Mapeados</TableHead>
                  <TableHead className="text-right">Sem código</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reports.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{formatBR(r.sales_date)}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{r.file_name ?? "—"}</TableCell>
                    <TableCell className="text-right">{QTY.format(Number(r.total_quantity))}</TableCell>
                    <TableCell className="text-right">{BRL.format(Number(r.total_revenue))}</TableCell>
                    <TableCell className="text-right">{r.mapped_count}</TableCell>
                    <TableCell className="text-right">
                      {r.unmapped_count > 0 ? (
                        <Badge variant="outline" className="text-amber-600 border-amber-600/40">{r.unmapped_count}</Badge>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => remove(r.id, formatBR(r.sales_date))}>
                        <Trash2 className="text-destructive h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}

function SummaryCard({ tone, label, count, desc }: { tone: "destructive" | "warning"; label: string; count: number; desc: string }) {
  const cls = tone === "destructive"
    ? "border-destructive/40 bg-destructive/5"
    : "border-amber-500/40 bg-amber-50/40 dark:bg-amber-950/20";
  const Icon = tone === "destructive" ? AlertTriangle : TrendingDown;
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="flex items-center gap-2 text-sm font-medium">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-1 text-3xl font-semibold">{count}</div>
      <div className="text-xs text-muted-foreground">{desc}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: ProjectedRow["status"] }) {
  if (status === "zerado") return <Badge variant="destructive">Zerado</Badge>;
  if (status === "abaixo_minimo") return <Badge variant="destructive">Abaixo do mínimo</Badge>;
  if (status === "proximo_minimo") return <Badge variant="outline" className="text-amber-700 border-amber-500/60">Próximo</Badge>;
  return <Badge variant="secondary">OK</Badge>;
}

// -------------------- Upload dialog --------------------

const HEADERS_CODE = ["codigo", "código", "cod", "sku", "produto_codigo", "product_code"];
const HEADERS_QTY = ["quantidade", "qtd", "qty", "quant", "vendas", "quantidade_vendida"];
const HEADERS_PRICE = ["preco", "preço", "preco_unitario", "preço_unitário", "valor", "valor_unitario", "unit_price"];

function norm(s: string) {
  return String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_");
}
function colLetterToIndex(letter: string) {
  const s = letter.trim().toUpperCase();
  let n = 0;
  for (const ch of s) {
    if (ch < "A" || ch > "Z") return -1;
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}
function parseNum(v: unknown) {
  if (v == null || v === "") return NaN;
  return Number(String(v).replace(/\./g, "").replace(",", "."));
}

function NewDailyReportDialog({ onDone }: { onDone: () => void }) {
  const [salesDate, setSalesDate] = useState(todayISO());
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [noHeader, setNoHeader] = useState(true);
  const [codeCol, setCodeCol] = useState("A");
  const [qtyCol, setQtyCol] = useState("B");
  const [priceCol, setPriceCol] = useState("");
  const create = useServerFn(createDailySalesReport);

  async function submit() {
    if (!file) return toast.error("Selecione um arquivo");
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      let rows: { product_code: string; quantity: number; unit_price: number | null }[] = [];
      if (noHeader) {
        const cIdx = colLetterToIndex(codeCol);
        const qIdx = colLetterToIndex(qtyCol);
        const pIdx = priceCol.trim() ? colLetterToIndex(priceCol) : -1;
        if (cIdx < 0 || qIdx < 0) throw new Error("Coluna de código ou quantidade inválida");
        const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "" });
        rows = raw.map((r) => {
          const code = String(r[cIdx] ?? "").trim();
          const qty = parseNum(r[qIdx]);
          const price = pIdx >= 0 ? parseNum(r[pIdx]) : NaN;
          return {
            product_code: code,
            quantity: isFinite(qty) ? qty : 0,
            unit_price: isFinite(price) && price > 0 ? price : null,
          };
        }).filter((r) => r.product_code && r.quantity > 0);
      } else {
        const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
        if (raw.length === 0) throw new Error("Planilha vazia");
        const keys = Object.keys(raw[0]);
        const normMap = new Map(keys.map((k) => [norm(k), k]));
        const codeKey = HEADERS_CODE.map((h) => normMap.get(h)).find(Boolean);
        const qtyKey = HEADERS_QTY.map((h) => normMap.get(h)).find(Boolean);
        const priceKey = HEADERS_PRICE.map((h) => normMap.get(h)).find(Boolean);
        if (!codeKey || !qtyKey) throw new Error("Planilha precisa ter colunas de código e quantidade, ou marque 'sem cabeçalho'");
        rows = raw.map((r) => {
          const code = String(r[codeKey] ?? "").trim();
          const qty = parseNum(r[qtyKey]);
          const price = priceKey ? parseNum(r[priceKey]) : NaN;
          return {
            product_code: code,
            quantity: isFinite(qty) ? qty : 0,
            unit_price: isFinite(price) && price > 0 ? price : null,
          };
        }).filter((r) => r.product_code && r.quantity > 0);
      }
      if (rows.length === 0) throw new Error("Nenhuma linha válida na planilha");

      const res = await create({
        data: { sales_date: salesDate, file_name: file.name, rows },
      });
      toast.success(`Dia gravado · ${res.mapped} produtos · ${res.ingredients} insumos atualizados${res.unmapped ? ` · ${res.unmapped} sem código` : ""}`);
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Vendas do dia</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>Data das vendas</Label>
          <Input type="date" value={salesDate} onChange={(e) => setSalesDate(e.target.value)} max={todayISO()} />
          <p className="mt-1 text-xs text-muted-foreground">
            Enviar novamente esta data substitui os valores anteriores.
          </p>
        </div>
        <div>
          <Label>Planilha (.xlsx, .csv)</Label>
          <Input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={noHeader} onChange={(e) => setNoHeader(e.target.checked)} />
          Planilha sem cabeçalho (escolher colunas manualmente)
        </label>
        {noHeader ? (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Coluna do código</Label>
              <Input value={codeCol} onChange={(e) => setCodeCol(e.target.value.toUpperCase())} placeholder="A" />
            </div>
            <div>
              <Label className="text-xs">Coluna da quantidade</Label>
              <Input value={qtyCol} onChange={(e) => setQtyCol(e.target.value.toUpperCase())} placeholder="B" />
            </div>
            <div>
              <Label className="text-xs">Preço unit. (opcional)</Label>
              <Input value={priceCol} onChange={(e) => setPriceCol(e.target.value.toUpperCase())} placeholder="—" />
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Colunas aceitas: <strong>código</strong> + <strong>quantidade</strong> (obrigatórias); preço opcional.
          </p>
        )}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={busy}>{busy ? "Enviando..." : "Enviar"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
