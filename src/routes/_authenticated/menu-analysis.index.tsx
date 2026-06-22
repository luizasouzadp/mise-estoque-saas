import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import * as XLSX from "xlsx";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, ArrowLeft, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { createSalesReport, deleteSalesReport, generateSalesInsights } from "@/lib/sales-reports.functions";

export const Route = createFileRoute("/_authenticated/menu-analysis/")({
  component: MenuAnalysisIndex,
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type Report = {
  id: string;
  reference_month: string;
  file_name: string | null;
  total_revenue: number;
  total_cost: number;
  total_margin: number;
  created_at: string;
};

function MenuAnalysisIndex() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);

  const { data: reports } = useQuery<Report[]>({
    queryKey: ["sales-reports"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("sales_reports")
        .select("id, reference_month, file_name, total_revenue, total_cost, total_margin, created_at")
        .order("reference_month", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const del = useServerFn(deleteSalesReport);
  async function remove(id: string) {
    if (!confirm("Excluir este relatório?")) return;
    try {
      await del({ data: { id } });
      toast.success("Excluído");
      qc.invalidateQueries({ queryKey: ["sales-reports"] });
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/pricing" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft className="mr-1 h-4 w-4" /> Voltar ao cardápio
          </Link>
          <h1 className="font-display text-3xl mt-1">Análise de vendas</h1>
          <p className="text-sm text-muted-foreground">Importe a planilha mensal de vendas e gere um diagnóstico completo do cardápio.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-1" /> Nova análise</Button>
          </DialogTrigger>
          <NewReportDialog onDone={(id) => { setOpen(false); nav({ to: "/menu-analysis/$id", params: { id } }); }} />
        </Dialog>
      </div>

      <div className="rounded-xl border bg-card shadow-[var(--shadow-soft)]">
        {!reports || reports.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">
            Nenhuma análise ainda. Importe a planilha mensal para começar.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mês de referência</TableHead>
                <TableHead>Arquivo</TableHead>
                <TableHead className="text-right">Faturamento</TableHead>
                <TableHead className="text-right">CMV</TableHead>
                <TableHead className="text-right">Margem</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reports.map((r) => {
                const cmv = r.total_revenue > 0 ? (r.total_cost / r.total_revenue) * 100 : 0;
                return (
                  <TableRow key={r.id} className="cursor-pointer hover:bg-secondary/50">
                    <TableCell onClick={() => nav({ to: "/menu-analysis/$id", params: { id: r.id } })}>
                      {formatMonth(r.reference_month)}
                    </TableCell>
                    <TableCell onClick={() => nav({ to: "/menu-analysis/$id", params: { id: r.id } })}>
                      <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                        <FileSpreadsheet className="h-3 w-3" /> {r.file_name ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">{BRL.format(r.total_revenue)}</TableCell>
                    <TableCell className="text-right">{cmv.toFixed(1)}%</TableCell>
                    <TableCell className="text-right">{BRL.format(r.total_margin)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="icon" onClick={() => remove(r.id)}>
                        <Trash2 className="text-destructive h-4 w-4" />
                      </Button>
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

function formatMonth(d: string) {
  const [y, m] = d.split("-");
  const names = ["jan","fev","mar","abr","mai","jun","jul","ago","set","out","nov","dez"];
  return `${names[Number(m) - 1]}/${y}`;
}

const HEADERS_CODE = ["codigo","código","cod","sku","produto_codigo","product_code"];
const HEADERS_QTY = ["quantidade","qtd","qty","quant","vendas","quantidade_vendida"];
const HEADERS_PRICE = ["preco","preço","preco_unitario","preço_unitário","valor","valor_unitario","preço_unitario","unit_price"];

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

function indexToColLetter(i: number) {
  let n = i + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function NewReportDialog({ onDone }: { onDone: (id: string) => void }) {
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [month, setMonth] = useState(defaultMonth);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [noHeader, setNoHeader] = useState(true);
  const [codeCol, setCodeCol] = useState("A");
  const [qtyCol, setQtyCol] = useState("B");
  const [priceCol, setPriceCol] = useState("");
  const [preview, setPreview] = useState<any[][]>([]);
  const create = useServerFn(createSalesReport);
  const insights = useServerFn(generateSalesInsights);

  async function loadPreview(f: File) {
    try {
      const buf = await f.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
      setPreview(rows.slice(0, 3));
    } catch {
      setPreview([]);
    }
  }

  function onFileChange(f: File | null) {
    setFile(f);
    if (f) loadPreview(f);
    else setPreview([]);
  }

  function parseNum(v: any) {
    if (v == null || v === "") return NaN;
    return Number(String(v).replace(/\./g, "").replace(",", "."));
  }

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

        const raw = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: "" });
        rows = raw
          .map((r) => {
            const code = String(r[cIdx] ?? "").trim();
            const qty = parseNum(r[qIdx]);
            const price = pIdx >= 0 ? parseNum(r[pIdx]) : NaN;
            return {
              product_code: code,
              quantity: isFinite(qty) ? qty : 0,
              unit_price: isFinite(price) && price > 0 ? price : null,
            };
          })
          .filter((r) => r.product_code && r.quantity > 0);
      } else {
        const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
        if (raw.length === 0) throw new Error("Planilha vazia");
        const sample = raw[0];
        const keys = Object.keys(sample);
        const normMap = new Map(keys.map((k) => [norm(k), k]));
        const codeKey = HEADERS_CODE.map((h) => normMap.get(h)).find(Boolean);
        const qtyKey = HEADERS_QTY.map((h) => normMap.get(h)).find(Boolean);
        const priceKey = HEADERS_PRICE.map((h) => normMap.get(h)).find(Boolean);
        if (!codeKey || !qtyKey) throw new Error("Planilha precisa ter colunas de código e quantidade, ou marque 'sem cabeçalho'");
        rows = raw
          .map((r) => {
            const code = String(r[codeKey!] ?? "").trim();
            const qty = parseNum(r[qtyKey!]);
            const price = priceKey ? parseNum(r[priceKey]) : NaN;
            return {
              product_code: code,
              quantity: isFinite(qty) ? qty : 0,
              unit_price: isFinite(price) && price > 0 ? price : null,
            };
          })
          .filter((r) => r.product_code && r.quantity > 0);
      }

      if (rows.length === 0) throw new Error("Nenhuma linha válida na planilha");

      const res = await create({
        data: {
          reference_month: `${month}-01`,
          file_name: file.name,
          rows,
        },
      });

      toast.success(`Relatório criado · ${res.mapped} itens mapeados · ${res.unmapped} sem código`);
      insights({ data: { report_id: res.id } }).catch(() => {});
      onDone(res.id);
    } catch (e: any) {
      toast.error(e.message ?? "Erro ao importar");
    } finally {
      setBusy(false);
    }
  }

  const cIdx = colLetterToIndex(codeCol);
  const qIdx = colLetterToIndex(qtyCol);
  const pIdx = priceCol.trim() ? colLetterToIndex(priceCol) : -1;

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Nova análise mensal</DialogTitle>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>Mês de referência</Label>
          <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <div>
          <Label>Planilha de vendas (.xlsx, .csv)</Label>
          <Input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => onFileChange(e.target.files?.[0] ?? null)} />
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
            Colunas aceitas: <strong>código</strong> + <strong>quantidade</strong> (obrigatórias); <strong>preço unitário</strong> (opcional).
          </p>
        )}

        {preview.length > 0 && (
          <div className="rounded-md border bg-muted/30 p-2 text-xs">
            <div className="font-medium mb-1 text-muted-foreground">Pré-visualização (3 primeiras linhas):</div>
            <div className="space-y-1 font-mono">
              {preview.map((row, i) => (
                <div key={i} className="flex gap-2 flex-wrap">
                  {row.map((cell: any, j: number) => {
                    const tag = noHeader
                      ? j === cIdx ? " (código)" : j === qIdx ? " (qtd)" : j === pIdx ? " (preço)" : ""
                      : "";
                    const cls = tag ? "bg-primary/15 px-1 rounded" : "text-muted-foreground";
                    return (
                      <span key={j} className={cls}>
                        {indexToColLetter(j)}={String(cell)}{tag}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <DialogFooter>
        <Button onClick={submit} disabled={busy}>{busy ? "Importando..." : "Importar e analisar"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}
