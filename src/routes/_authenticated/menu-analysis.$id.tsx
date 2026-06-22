import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import ReactMarkdown from "react-markdown";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, ReferenceLine, BarChart, Bar, Legend } from "recharts";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Sparkles, Loader2, Download } from "lucide-react";
import { toast } from "sonner";
import { generateSalesInsights } from "@/lib/sales-reports.functions";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const Route = createFileRoute("/_authenticated/menu-analysis/$id")({
  component: MenuAnalysisDetail,
});

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const COLORS = ["hsl(var(--primary))", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];

type Report = {
  id: string;
  reference_month: string;
  file_name: string | null;
  total_revenue: number;
  total_cost: number;
  total_margin: number;
  total_quantity: number;
  ai_insights: string | null;
};

type Item = {
  id: string;
  product_code: string;
  item_name: string;
  category: string | null;
  source: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  revenue: number;
  total_cost: number;
  margin: number;
};

type Unmapped = { product_code: string; quantity: number };

function MenuAnalysisDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [regenerating, setRegenerating] = useState(false);

  const { data: report } = useQuery<Report | null>({
    queryKey: ["sales-report", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sales_reports").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: (q) => (q.state.data && !q.state.data.ai_insights ? 3000 : false),
  });

  const { data: items } = useQuery<Item[]>({
    queryKey: ["sales-report-items", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sales_report_items").select("*").eq("report_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: unmapped } = useQuery<Unmapped[]>({
    queryKey: ["sales-report-unmapped", id],
    queryFn: async () => {
      const { data, error } = await (supabase as any).from("sales_report_unmapped").select("product_code, quantity").eq("report_id", id);
      if (error) throw error;
      return data ?? [];
    },
  });

  const insights = useServerFn(generateSalesInsights);
  async function regenerate() {
    setRegenerating(true);
    try {
      await insights({ data: { report_id: id } });
      qc.invalidateQueries({ queryKey: ["sales-report", id] });
      toast.success("Parecer atualizado");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setRegenerating(false);
    }
  }

  const byCategory = useMemo(() => {
    const map = new Map<string, { revenue: number; cost: number; quantity: number; count: number }>();
    for (const i of items ?? []) {
      const c = i.category ?? "Sem categoria";
      const e = map.get(c) ?? { revenue: 0, cost: 0, quantity: 0, count: 0 };
      e.revenue += Number(i.revenue);
      e.cost += Number(i.total_cost);
      e.quantity += Number(i.quantity);
      e.count += 1;
      map.set(c, e);
    }
    return Array.from(map.entries()).map(([name, v]) => ({
      name,
      revenue: v.revenue,
      cost: v.cost,
      cmv_pct: v.revenue > 0 ? (v.cost / v.revenue) * 100 : 0,
      quantity: v.quantity,
      count: v.count,
    })).sort((a, b) => b.revenue - a.revenue);
  }, [items]);

  const matrix = useMemo(() => {
    const list = items ?? [];
    if (list.length === 0) return { avgQty: 0, avgMargin: 0, points: [], quadrants: { champ: [], hidden: [], dog: [], problem: [] } as Record<string, any[]> };
    const avgQty = list.reduce((s, i) => s + Number(i.quantity), 0) / list.length;
    const avgMargin = list.reduce((s, i) => {
      const r = Number(i.revenue);
      return s + (r > 0 ? (Number(i.margin) / r) * 100 : 0);
    }, 0) / list.length;
    const points = list.map((i) => {
      const r = Number(i.revenue);
      const marginPct = r > 0 ? (Number(i.margin) / r) * 100 : 0;
      const hi = Number(i.quantity) >= avgQty;
      const ha = marginPct >= avgMargin;
      const q = hi && ha ? "champ" : !hi && ha ? "hidden" : hi && !ha ? "dog" : "problem";
      return { ...i, quantity: Number(i.quantity), marginPct, quadrant: q };
    });
    const quadrants = {
      champ: points.filter((p) => p.quadrant === "champ"),
      hidden: points.filter((p) => p.quadrant === "hidden"),
      dog: points.filter((p) => p.quadrant === "dog"),
      problem: points.filter((p) => p.quadrant === "problem"),
    };
    return { avgQty, avgMargin, points, quadrants };
  }, [items]);

  if (!report) return <div className="p-8">Carregando...</div>;

  const cmvGlobal = report.total_revenue > 0 ? (report.total_cost / report.total_revenue) * 100 : 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/menu-analysis" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary">
            <ArrowLeft className="mr-1 h-4 w-4" /> Análises
          </Link>
          <h1 className="font-display text-3xl mt-1">Análise de {formatMonth(report.reference_month)}</h1>
          <p className="text-sm text-muted-foreground">{report.file_name}</p>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Faturamento" value={BRL.format(report.total_revenue)} />
        <Kpi label="Custo total" value={BRL.format(report.total_cost)} />
        <Kpi label="Margem" value={BRL.format(report.total_margin)} />
        <Kpi label="CMV global" value={`${cmvGlobal.toFixed(1)}%`} />
      </div>

      {/* Charts row */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Faturamento por categoria">
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={byCategory} dataKey="revenue" nameKey="name" outerRadius={100} label={(e: any) => e.name}>
                {byCategory.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => BRL.format(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card title="CMV % por categoria">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={byCategory}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => `${v.toFixed(0)}%`} />
              <Tooltip formatter={(v: any) => `${Number(v).toFixed(1)}%`} />
              <Bar dataKey="cmv_pct" name="CMV" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      {/* Top itens por categoria */}
      <Card title="Top itens por categoria">
        {byCategory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem dados.</p>
        ) : (
          <Tabs defaultValue={byCategory[0].name}>
            <TabsList className="flex-wrap h-auto">
              {byCategory.map((c) => <TabsTrigger key={c.name} value={c.name}>{c.name}</TabsTrigger>)}
            </TabsList>
            {byCategory.map((c) => {
              const top = (items ?? [])
                .filter((i) => (i.category ?? "Sem categoria") === c.name)
                .sort((a, b) => Number(b.revenue) - Number(a.revenue))
                .slice(0, 5);
              return (
                <TabsContent key={c.name} value={c.name}>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Item</TableHead>
                        <TableHead className="text-right">Qtd</TableHead>
                        <TableHead className="text-right">Faturamento</TableHead>
                        <TableHead className="text-right">Margem %</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {top.map((i) => {
                        const m = Number(i.revenue) > 0 ? (Number(i.margin) / Number(i.revenue)) * 100 : 0;
                        return (
                          <TableRow key={i.id}>
                            <TableCell>{i.item_name}</TableCell>
                            <TableCell className="text-right">{Number(i.quantity).toLocaleString("pt-BR")}</TableCell>
                            <TableCell className="text-right">{BRL.format(Number(i.revenue))}</TableCell>
                            <TableCell className="text-right">{m.toFixed(1)}%</TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TabsContent>
              );
            })}
          </Tabs>
        )}
      </Card>

      {/* Matriz BCG */}
      <Card title="Matriz do cardápio (engenharia de menu)">
        <p className="text-xs text-muted-foreground mb-3">
          Linhas divisórias: média de quantidade ({matrix.avgQty.toFixed(0)}) e média de margem ({matrix.avgMargin.toFixed(1)}%).
        </p>
        <ResponsiveContainer width="100%" height={320}>
          <ScatterChart margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
            <XAxis type="number" dataKey="quantity" name="Quantidade" />
            <YAxis type="number" dataKey="marginPct" name="Margem %" tickFormatter={(v) => `${v.toFixed(0)}%`} />
            <ReferenceLine x={matrix.avgQty} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            <ReferenceLine y={matrix.avgMargin} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
            <Tooltip cursor={{ strokeDasharray: "3 3" }} content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const d: any = payload[0].payload;
              return (
                <div className="rounded-md border bg-card px-3 py-2 text-xs shadow">
                  <div className="font-medium">{d.item_name}</div>
                  <div>Qtd: {d.quantity}</div>
                  <div>Margem: {d.marginPct.toFixed(1)}%</div>
                  <div>Faturamento: {BRL.format(d.revenue)}</div>
                </div>
              );
            }} />
            <Scatter name="Campeões" data={matrix.quadrants.champ} fill="#10b981" />
            <Scatter name="Tesouros escondidos" data={matrix.quadrants.hidden} fill="#3b82f6" />
            <Scatter name="Queridinhos" data={matrix.quadrants.dog} fill="#f59e0b" />
            <Scatter name="Problemas" data={matrix.quadrants.problem} fill="#ef4444" />
            <Legend />
          </ScatterChart>
        </ResponsiveContainer>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mt-4">
          <QuadrantList title="Campeões" desc="Vende muito + alta margem" color="bg-green-500/15 text-green-700 dark:text-green-400" items={matrix.quadrants.champ} />
          <QuadrantList title="Tesouros escondidos" desc="Vende pouco + alta margem" color="bg-blue-500/15 text-blue-700 dark:text-blue-400" items={matrix.quadrants.hidden} />
          <QuadrantList title="Queridinhos" desc="Vende muito + baixa margem" color="bg-amber-500/15 text-amber-700 dark:text-amber-400" items={matrix.quadrants.dog} />
          <QuadrantList title="Problemas" desc="Vende pouco + baixa margem" color="bg-red-500/15 text-red-700 dark:text-red-400" items={matrix.quadrants.problem} />
        </div>
      </Card>

      {/* AI parecer */}
      <Card title={<div className="flex items-center justify-between w-full"><span className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /> Parecer da IA</span><Button size="sm" variant="outline" onClick={regenerate} disabled={regenerating}>{regenerating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}Regenerar</Button></div>}>
        {!report.ai_insights ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Gerando parecer...</p>
        ) : (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <ReactMarkdown>{report.ai_insights}</ReactMarkdown>
          </div>
        )}
      </Card>

      {unmapped && unmapped.length > 0 && (
        <Card title="Códigos não encontrados no cardápio">
          <p className="text-xs text-muted-foreground mb-2">Vincule esses códigos a fichas técnicas ou produtos manuais para incluí-los na próxima análise.</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead className="text-right">Quantidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unmapped.map((u, i) => (
                <TableRow key={i}>
                  <TableCell>{u.product_code}</TableCell>
                  <TableCell className="text-right">{Number(u.quantity).toLocaleString("pt-BR")}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-[var(--shadow-soft)]">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-display text-2xl mt-1">{value}</div>
    </div>
  );
}

function Card({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4 md:p-6 shadow-[var(--shadow-soft)]">
      <div className="mb-3 font-medium">{title}</div>
      {children}
    </div>
  );
}

function QuadrantList({ title, desc, color, items }: { title: string; desc: string; color: string; items: any[] }) {
  return (
    <div className="rounded-lg border bg-background p-3">
      <Badge variant="outline" className={color}>{title}</Badge>
      <p className="text-xs text-muted-foreground mt-1">{desc}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {items.length === 0 ? <li className="text-muted-foreground text-xs">—</li> : items.slice(0, 5).map((i) => (
          <li key={i.id} className="truncate" title={i.item_name}>• {i.item_name}</li>
        ))}
        {items.length > 5 && <li className="text-xs text-muted-foreground">+ {items.length - 5} outros</li>}
      </ul>
    </div>
  );
}

function formatMonth(d: string) {
  const [y, m] = d.split("-");
  const names = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
  return `${names[Number(m) - 1]}/${y}`;
}
